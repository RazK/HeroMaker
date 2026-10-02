"""
Result cache for the paid pipeline steps - STAGING ONLY, opt-in.

WHY
---
The staging robot (e2e/staging-robot.mjs) uploads the very same drawing on
every run, and every run used to pay OpenAI (~$0.167) and Meshy (20 credits,
~$0.40) to turn it into the very same hero. With this cache on, the first run
pays and fills the cache; every later run with byte-identical input copies the
stored outputs into the new creation and never calls the provider.

WHAT IT KEYS ON
---------------
    sha256(format, step name, sha256(input file bytes), sha256(version))

where "version" is everything the provider call depends on besides the input
file: for openai_render the prompt text plus model/size/quality/background/
output_format/n (app.services.openai.render_cache_version), for the Meshy steps
the request parameters. Edit the prompt or a parameter and the key changes, so
the cache misses and the provider is called - nothing has to be invalidated by
hand.

WHERE IT STORES
---------------
Through the normal storage backend (app/utils/storage.py: S3 on Railway, disk
locally), under the pseudo-user CACHE_OWNER:

    _pipeline_result_cache/<step>-<key>/<output files...>
    _pipeline_result_cache/<step>-<key>/manifest.json   <- written LAST

An entry counts only once its manifest exists and every file it lists is
present, so a half-written entry is a miss, not a broken hero.

WHAT IT DOES NOT CHANGE
-----------------------
* The user is charged credits exactly as before. The cache runs INSIDE the step
  coroutine, after `execute_step` has charged, and a hit is a successful step.
  Refund paths are untouched: a failure while restoring falls back to calling
  the provider, and anything the provider then does wrong refunds as always.
* A hit writes NO paid usage_event. It writes one zero-cost row, provider
  "internal", operation pricing.OP_RESULT_CACHE_HIT, status "cache_hit", with
  the avoided list price in its metadata - so the margin report stays true and
  the saving is still visible.

WHEN IT IS ON
-------------
Only when PIPELINE_RESULT_CACHE is set to 1/true/yes/on. Default off. And never
in a Railway environment named "production", whatever the flag says: a
production user must get their own render, not a stranger's, and a missed
provider call there would also make the margin report lie.

The cache NEVER breaks a step: any error looking up or saving is logged and
treated as a miss.
"""
import hashlib
import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, Iterable, Optional

from app.config import pricing
from app.config.packs import STEP_PROVIDER_COST
from app.config.steps import get_step_by_name
from app.services import usage as usage_service
from app.services.usage import UsageContext
from app.utils.storage import get_storage

logger = logging.getLogger(__name__)

ENV_FLAG = "PIPELINE_RESULT_CACHE"

# The storage "user" every cache entry lives under. Real user ids are UUIDs, so
# this cannot collide with one.
CACHE_OWNER = "_pipeline_result_cache"

MANIFEST = "manifest.json"

# Bump to orphan every existing entry at once (e.g. if the manifest layout
# changes). Part of the key.
CACHE_FORMAT = 1

# Steps whose output is worth caching: the ones that cost us money.
CACHEABLE_STEPS = ("openai_render", "meshy_3d", "meshy_rig")

_TRUE = {"1", "true", "yes", "on"}


def _is_production() -> bool:
    env = os.getenv("RAILWAY_ENVIRONMENT_NAME") or os.getenv("RAILWAY_ENVIRONMENT") or ""
    return env.strip().lower() == "production"


def enabled() -> bool:
    """Is the cache switched on for this process? Read on every call."""
    if os.getenv(ENV_FLAG, "").strip().lower() not in _TRUE:
        return False
    if _is_production():
        logger.error(
            "%s is set in the production environment; ignoring it. The result "
            "cache is for staging only.", ENV_FLAG,
        )
        return False
    return True


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def version_hash(version: Dict[str, Any]) -> str:
    """Stable hash of the parameters a step's provider call depends on."""
    return _sha256(json.dumps(version, sort_keys=True, default=str).encode("utf-8"))


def compute_key(step_name: str, input_bytes: bytes, version: Dict[str, Any]) -> str:
    material = json.dumps(
        {
            "format": CACHE_FORMAT,
            "step": step_name,
            "input_sha256": _sha256(input_bytes),
            "version_sha256": version_hash(version),
        },
        sort_keys=True,
    )
    return _sha256(material.encode("utf-8"))


def entry_id(step_name: str, key: str) -> str:
    """The storage 'creation id' of a cache entry."""
    return f"{step_name}-{key}"


def _avoided_cost(step_name: str):
    """(provider, operation, list price in micros) of the call a hit skipped."""
    provider, operation = STEP_PROVIDER_COST.get(step_name, (None, None))
    if not provider or not operation:
        return provider, operation, 0
    return provider, operation, pricing.unit_cost_usd_micros(provider, operation)


@dataclass
class CacheAttempt:
    """
    One step's go at the cache.

    `hit` - the outputs are already in the creation; skip the provider.
    `metadata` - what the step stored alongside its files (e.g. Meshy task ids).
    `save(...)` - after a miss, store the step's fresh outputs. No-op when the
    cache is off. Never raises.
    """
    step_name: str
    user_id: str
    creation_id: str
    key: Optional[str] = None
    version: Dict[str, Any] = field(default_factory=dict)
    input_sha256: Optional[str] = None
    hit: bool = False
    metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def active(self) -> bool:
        return self.key is not None

    def marker(self) -> Dict[str, Any]:
        """What the step records in its own metadata_json about the cache."""
        return {"hit": self.hit, "key": self.key}

    def save(self, files: Iterable[str], metadata: Optional[Dict[str, Any]] = None) -> bool:
        if not self.active or self.hit:
            return False
        files = list(files)
        storage = get_storage()
        eid = entry_id(self.step_name, self.key)
        try:
            for name in files:
                data = storage.download_file(self.user_id, self.creation_id, name)
                storage.upload_file(CACHE_OWNER, eid, name, data)
            manifest = {
                "format": CACHE_FORMAT,
                "step": self.step_name,
                "key": self.key,
                "input_sha256": self.input_sha256,
                "version_sha256": version_hash(self.version),
                "version": self.version,
                "files": files,
                "metadata": metadata or {},
                "source_creation_id": self.creation_id,
                "created_at": datetime.utcnow().isoformat() + "Z",
            }
            # Last, so a crash half-way through leaves an entry that is a miss.
            storage.upload_file(
                CACHE_OWNER, eid, MANIFEST,
                json.dumps(manifest, indent=2, sort_keys=True).encode("utf-8"),
            )
            logger.info("[%s] result cache: stored %s %s (%s)",
                        self.creation_id, self.step_name, self.key[:12], ", ".join(files))
            return True
        except Exception:
            logger.warning("[%s] result cache: could not store %s %s; carrying on",
                           self.creation_id, self.step_name, self.key, exc_info=True)
            return False


def _load_manifest(step_name: str, key: str) -> Optional[Dict[str, Any]]:
    storage = get_storage()
    eid = entry_id(step_name, key)
    if not storage.file_exists(CACHE_OWNER, eid, MANIFEST):
        return None
    manifest = json.loads(storage.download_file(CACHE_OWNER, eid, MANIFEST))
    if manifest.get("key") != key or manifest.get("step") != step_name:
        return None
    for name in manifest.get("files", []):
        if not storage.file_exists(CACHE_OWNER, eid, name):
            logger.warning("result cache: %s %s lists %s but it is missing; miss",
                           step_name, key, name)
            return None
    return manifest


def begin(step_name: str, user_id: str, creation_id: str, version: Dict[str, Any]) -> CacheAttempt:
    """
    Look the step up and, on a hit, copy the cached outputs into the creation
    and record a zero-cost usage event. Synchronous (storage I/O): call it from
    an executor.
    """
    attempt = CacheAttempt(step_name=step_name, user_id=user_id,
                           creation_id=creation_id, version=version)
    if step_name not in CACHEABLE_STEPS or not enabled():
        return attempt

    try:
        storage = get_storage()
        input_name = get_step_by_name(step_name)["input"]
        input_bytes = storage.download_file(user_id, creation_id, input_name)
        attempt.input_sha256 = _sha256(input_bytes)
        attempt.key = compute_key(step_name, input_bytes, version)

        manifest = _load_manifest(step_name, attempt.key)
        if manifest is None:
            logger.info("[%s] result cache: miss %s %s", creation_id, step_name, attempt.key[:12])
            return attempt

        eid = entry_id(step_name, attempt.key)
        for name in manifest["files"]:
            storage.upload_file(user_id, creation_id, name,
                                storage.download_file(CACHE_OWNER, eid, name))
    except Exception:
        # Lookup or restore broke: behave exactly as if there were no cache
        # entry. The provider gets called and the result is stored afresh.
        logger.warning("[%s] result cache: lookup/restore failed for %s; calling the provider",
                       creation_id, step_name, exc_info=True)
        return attempt

    attempt.hit = True
    attempt.metadata = dict(manifest.get("metadata") or {})
    provider, operation, avoided = _avoided_cost(step_name)
    usage_service.record_usage(
        UsageContext.for_step(creation_id, user_id, step_name),
        pricing.PROVIDER_INTERNAL,
        pricing.OP_RESULT_CACHE_HIT,
        quantity=1,
        status="cache_hit",
        provider_ref=attempt.key,
        cost_usd_micros=0,
        units=0,
        metadata={
            "cache_hit": True,
            "cache_key": attempt.key,
            "skipped_provider": provider,
            "skipped_operation": operation,
            # What this call would have cost. NOT spent - the saving, kept
            # visible the same way a failed call keeps its list price.
            "avoided_list_price_usd_micros": avoided,
            "source_creation_id": manifest.get("source_creation_id"),
        },
    )
    logger.info("[%s] result cache: HIT %s %s - provider not called (saved %s)",
                creation_id, step_name, attempt.key[:12], pricing.micros_to_usd_str(avoided))
    return attempt
