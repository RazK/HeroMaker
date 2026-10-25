"""CORS for the public API: any website may call /api/v1 and /mcp from a browser.

The app's own CORSMiddleware allows only ALLOWED_ORIGINS, with cookies. The
public API carries no cookies: it is authorised by an API key in a header, and
a publishable key checks the page's Origin itself (app/services/api_keys.py).
So for these paths any origin is answered, without credentials. This runs
outside the app's CORSMiddleware, which never sees these paths' preflights.
"""
from starlette.types import ASGIApp, Message, Receive, Scope, Send

PUBLIC_PREFIXES = ("/api/v1", "/mcp")
ALLOW_HEADERS = "Authorization, Content-Type, X-Api-Key, Mcp-Session-Id, Mcp-Protocol-Version"
EXPOSE_HEADERS = "Mcp-Session-Id, Retry-After"


class PublicCORS:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http" or not scope["path"].startswith(PUBLIC_PREFIXES):
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers") or [])
        origin = headers.get(b"origin")
        if scope["method"] == "OPTIONS" and origin and b"access-control-request-method" in headers:
            await send({"type": "http.response.start", "status": 204, "headers": [
                (b"access-control-allow-origin", origin),
                (b"access-control-allow-methods", b"GET, POST, DELETE, OPTIONS"),
                (b"access-control-allow-headers", ALLOW_HEADERS.encode()),
                (b"access-control-max-age", b"600"),
                (b"vary", b"Origin"),
            ]})
            await send({"type": "http.response.body", "body": b""})
            return

        async def send_with_cors(message: Message):
            if message["type"] == "http.response.start" and origin:
                kept = [(k, v) for k, v in message.get("headers", []) if not k.lower().startswith(b"access-control-")]
                kept += [(b"access-control-allow-origin", origin),
                         (b"access-control-expose-headers", EXPOSE_HEADERS.encode()),
                         (b"vary", b"Origin")]
                message["headers"] = kept
            await send(message)

        # The inner CORSMiddleware only decorates a non-preflight response;
        # its access-control headers are replaced by ours above.
        await self.app(scope, receive, send_with_cors)
