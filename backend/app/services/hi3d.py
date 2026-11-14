"""Hi3D (hi3d.ai, formerly Hitem3D): split a character for printing, with joints.

docs.hi3d.ai/en/api. Unlike Meshy's Auto Split, Hi3D takes any model by URL or
upload - so a hero of any age can be split - and its character mode cuts
along the body with ball joints, so the printed figure still moves at the
shoulders and hips like an action figure.

Auth is two steps: the account's Access Key / Secret Key (HI3D_CLIENT_ID /
HI3D_CLIENT_SECRET) buy a bearer token at /open-api/v1/auth/token, and every
other call carries that token. Answers are wrapped: {"code", "data", "msg"},
code 200 meaning success. A result URL is valid for one hour, so the caller
downloads it at once.
"""
from __future__ import annotations

import base64
import logging
import os
import threading
import time
from typing import Any, Dict, Optional

import requests

from app.config import pricing
from app.services import usage as usage_service
from app.services.usage import UsageContext

logger = logging.getLogger(__name__)

BASE_URL = os.getenv("HI3D_BASE_URL", "https://api.hitem3d.ai")
# The docs do not say how long a token lives; refresh well inside an hour and
# on any 401.
TOKEN_SECONDS = 30 * 60

CHARACTER_PARTS = {  # Hi3D's character templates
    "a": 6, "b": 5, "c": 4, "d": 4, "e": 3, "f": 2,
}
JOINTS = ("ball", "pin", "dovetail", "none")
FORMAT_GLB = 2


class Hi3dError(Exception):
    """Hi3D refused or failed. `code` is Hi3D's own error code when it gave one."""

    def __init__(self, message: str, code: Any = None, status_code: Optional[int] = None):
        super().__init__(message)
        self.code = code
        self.status_code = status_code


class Hi3dNotConfigured(Hi3dError):
    pass


def is_out_of_balance(error: Exception) -> bool:
    """Hi3D says our API balance is empty. It answers in Chinese: 余额不足, "insufficient balance"."""
    text = str(error).lower()
    return "余额不足" in text or "insufficient balance" in text or "balance" in text and "not enough" in text


_token_lock = threading.Lock()
_token: Dict[str, Any] = {"value": None, "at": 0.0}


class Hi3dClient:
    def __init__(self, client_id: Optional[str] = None, client_secret: Optional[str] = None):
        self.client_id = client_id or os.getenv("HI3D_CLIENT_ID")
        self.client_secret = client_secret or os.getenv("HI3D_CLIENT_SECRET")
        if not self.client_id or not self.client_secret:
            raise Hi3dNotConfigured("HI3D_CLIENT_ID / HI3D_CLIENT_SECRET are not set")

    # -- auth ---------------------------------------------------------------

    def _token(self, fresh: bool = False) -> str:
        with _token_lock:
            if not fresh and _token["value"] and time.time() - _token["at"] < TOKEN_SECONDS:
                return _token["value"]
            basic = base64.b64encode(f"{self.client_id}:{self.client_secret}".encode()).decode()
            response = requests.post(f"{BASE_URL}/open-api/v1/auth/token",
                                     headers={"Authorization": f"Basic {basic}", "Content-Type": "application/json"},
                                     json={}, timeout=30)
            data = self._unwrap(response)
            token = data.get("accessToken") if isinstance(data, dict) else None
            if not token:
                raise Hi3dError("Hi3D gave no access token")
            _token.update(value=token, at=time.time())
            return token

    @staticmethod
    def _unwrap(response: requests.Response) -> Any:
        try:
            body = response.json()
        except ValueError:
            raise Hi3dError(f"HTTP {response.status_code}: {response.text[:200]}", status_code=response.status_code)
        code = body.get("code") if isinstance(body, dict) else None
        if response.status_code >= 400 or (code is not None and str(code) not in ("200", "0")):
            raise Hi3dError(str(body.get("msg") or body.get("message") or body)[:300], code=code,
                            status_code=response.status_code)
        return body.get("data") if isinstance(body, dict) else body

    def _call(self, method: str, path: str, **kw) -> Any:
        for attempt in (0, 1):
            headers = {"Authorization": f"Bearer {self._token(fresh=attempt == 1)}"}
            response = requests.request(method, f"{BASE_URL}{path}", headers=headers, timeout=120, **kw)
            if response.status_code == 401 and attempt == 0:
                continue
            return self._unwrap(response)
        raise Hi3dError("unauthorised")  # pragma: no cover - the loop always returns

    # -- split ----------------------------------------------------------------

    def create_character_split(self, *, mesh_url: Optional[str] = None, mesh: Optional[bytes] = None,
                               part: str = "a", joint: str = "ball", merge: bool = True,
                               usage: Optional[UsageContext] = None) -> str:
        """Start a character split; returns Hi3D's task id. One model in, a GLB of the parts out."""
        if part not in CHARACTER_PARTS:
            raise ValueError(f"part must be one of {sorted(CHARACTER_PARTS)}")
        if joint not in JOINTS:
            raise ValueError(f"joint must be one of {JOINTS}")
        form = {"model": "character", "part": part, "joint": joint, "format": str(FORMAT_GLB)}
        if joint != "none":
            form["merge"] = "yes" if merge else "no"
        if mesh_url:
            form["mesh_url"] = mesh_url
        elif mesh is None:
            raise ValueError("mesh_url or mesh is required")
        # Hi3D takes multipart/form-data only (a urlencoded form is 415), also
        # when no file is sent: every field goes as a part of its own.
        files = {k: (None, v) for k, v in form.items()}
        if mesh is not None:
            files["mesh"] = ("model.glb", mesh, "model/gltf-binary")
        with usage_service.track(
            usage, pricing.PROVIDER_HI3D, pricing.OP_HI3D_SPLIT, quantity=1,
            metadata={"part": part, "joint": joint, "merge": merge},
            finalize_on_success=False,
        ) as call:
            data = self._call("POST", "/open-api/v1/split/create-task", files=files)
            task_id = (data or {}).get("task_id")
            if not task_id:
                raise Hi3dError(f"Hi3D gave no task id: {data}")
            call.provider_ref = task_id
        return task_id

    def get_split(self, task_id: str) -> Dict[str, Any]:
        """{"state": created|queueing|processing|success|failed, "url", "cover_url", ...}"""
        return self._call("GET", "/open-api/v1/split/query-task", params={"task_id": task_id}) or {}
