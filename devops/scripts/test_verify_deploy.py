#!/usr/bin/env python3
"""Tests for verify_deploy.py.

Run:  .venv/bin/python devops/scripts/test_verify_deploy.py
      (stdlib only, like the tool it tests)

Everything runs against a real local HTTP server rather than a mocked
urlopen, because the failure this script exists to catch is a transport-level
one - a service that answers, but answers as the wrong build. A mock that
returns whatever the test wants cannot fail that way, and a test that cannot
fail is the exact mistake this whole change is fixing.
"""

import json
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import verify_deploy as tool  # noqa: E402

NEW = "a" * 40
OLD = "b" * 40


class _Handler(BaseHTTPRequestHandler):
    payload = None       # set per-test; None means "answer 502"
    status = 200
    raw = None           # when set, served verbatim instead of JSON

    def do_GET(self):
        if self.raw is not None:
            body = self.raw.encode()
            self.send_response(self.status)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.payload is None:
            self.send_response(502)
            self.end_headers()
            return
        body = json.dumps(self.payload).encode()
        self.send_response(self.status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass  # keep the test output readable


class Server:
    """A throwaway HTTP server serving one fixed /health payload."""

    def __init__(self, payload=None, status=200, raw=None):
        handler = type("H", (_Handler,),
                       {"payload": payload, "status": status, "raw": raw})
        self.httpd = HTTPServer(("127.0.0.1", 0), handler)
        self.url = f"http://127.0.0.1:{self.httpd.server_port}"

    def __enter__(self):
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        return self

    def __exit__(self, *_exc):
        self.httpd.shutdown()
        self.httpd.server_close()


class ProbeTests(unittest.TestCase):
    def test_matching_commit_is_a_match(self):
        with Server({"status": "healthy", "version": NEW}) as s:
            outcome, seen, _ = tool.probe(s.url + "/health", NEW)
            self.assertEqual(outcome, tool.MATCH)
            self.assertEqual(seen, NEW)

    def test_a_different_commit_is_stale_not_a_pass(self):
        """The whole point: 200 + healthy is NOT success."""
        with Server({"status": "healthy", "version": OLD}) as s:
            outcome, seen, note = tool.probe(s.url + "/health", NEW)
            self.assertEqual(outcome, tool.STALE)
            self.assertEqual(seen, OLD)
            self.assertIn(OLD[:7], note)

    def test_healthy_without_a_version_is_stale(self):
        """Exactly what production served: healthy, and four days out of date.

        No `version` key means the image predates build_info.py, which is
        itself proof the deploy never landed. It must not be reported as
        merely unreachable - the service is plainly up.
        """
        with Server({"status": "healthy", "service": "HeroMaker API"}) as s:
            outcome, seen, note = tool.probe(s.url + "/health", NEW)
            self.assertEqual(outcome, tool.STALE)
            self.assertIsNone(seen)
            self.assertIn("before deploy verification", note)

    def test_error_response_is_unreachable(self):
        with Server(None) as s:
            outcome, _seen, note = tool.probe(s.url + "/health", NEW)
            self.assertEqual(outcome, tool.UNREACHABLE)
            self.assertIn("502", note)

    def test_non_json_is_unreachable(self):
        """An nginx error page or a Railway holding page, not our service."""
        with Server(raw="<html>Application not found</html>") as s:
            outcome, seen, note = tool.probe(s.url + "/health", NEW)
            self.assertEqual(outcome, tool.UNREACHABLE)
            self.assertIsNone(seen)
            self.assertIn("not JSON", note)

    def test_nothing_listening_is_unreachable(self):
        with Server({"status": "healthy", "version": NEW}) as s:
            url = s.url + "/health"
        # Server is now shut down, so the port refuses the connection.
        outcome, _seen, _note = tool.probe(url, NEW)
        self.assertEqual(outcome, tool.UNREACHABLE)


class ExitCodeTests(unittest.TestCase):
    def test_match_exits_zero(self):
        with Server({"status": "healthy", "version": NEW}) as s:
            code = tool.main([s.url, "--expect-sha", NEW, "--timeout", "5"])
            self.assertEqual(code, 0)

    def test_stale_exits_nonzero_within_the_timeout(self):
        with Server({"status": "healthy", "version": OLD}) as s:
            code = tool.main([s.url, "--expect-sha", NEW, "--timeout", "2"])
            self.assertEqual(code, 1)

    def test_down_exits_nonzero(self):
        with Server(None) as s:
            code = tool.main([s.url, "--expect-sha", NEW, "--timeout", "2"])
            self.assertEqual(code, 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
