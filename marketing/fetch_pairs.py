"""
Pull real drawing -> hero pairs off the live HeroMaker site.

The landing page's whole claim is that a child's drawing becomes a real 3D
hero. The only honest way to show that is with a drawing and the hero it
actually became - not an illustration of one, and not two unrelated images
placed side by side. The live product has 82 completed heroes; this fetches
their originals and renders as matched pairs.

    .venv/bin/python marketing/fetch_pairs.py                 # the used set
    .venv/bin/python marketing/fetch_pairs.py --all           # every named hero
    .venv/bin/python marketing/fetch_pairs.py --list          # names only

Only a handful of pairs are committed - the ones the concepts actually use.
The rest are re-fetchable with --all, which is why they are gitignored rather
than carried as four megabytes of duplicate marketing assets.

The gallery endpoint is public and read-only; no key is needed.
"""
import argparse
import json
import sys
import urllib.request
from io import BytesIO
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is missing. Run this with .venv/bin/python, not bare python.")

SITE = "https://heromaker.up.railway.app"
OUT = Path(__file__).resolve().parent / "photos" / "pairs"

# The pairs the landing-page concepts reference. cookie-man is the lead: the
# drawing has blue eyes, a red smile and three buttons in red, orange and
# green, and so does the render - which is why it convinces at a glance.
USED = ("cookie-man", "crayon-kid", "turtle-cool", "super-sevivon",
        "lady-milana", "dooby-dam-dam")

MAX_EDGE = 1400
QUALITY = 86


def slug(name: str) -> str:
    return name.strip().lower().replace(" ", "-").replace("_", "-").replace(".", "")


def fetch(url: str, timeout: int = 45) -> bytes:
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.read()


def completed_named_heroes():
    """
    Every finished hero on the live site that has a name.

    The gallery answers with a bare list at small limits and a paginated
    {"creations": [...], "total": n} envelope at larger ones, so accept both
    rather than depending on which side of that threshold a limit falls.
    """
    body = json.loads(fetch(f"{SITE}/api/creations/?limit=500"))
    rows = body["creations"] if isinstance(body, dict) else body
    return [r for r in rows
            if r.get("status") == "completed" and r.get("character_name")]


def save(raw: bytes, dest: Path) -> int:
    image = Image.open(BytesIO(raw)).convert("RGB")
    image.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    image.save(dest, "JPEG", quality=QUALITY, optimize=True)
    return dest.stat().st_size


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--all", action="store_true",
                    help="every named hero, not just the ones the concepts use")
    ap.add_argument("--list", action="store_true",
                    help="print the available heroes and exit")
    args = ap.parse_args()

    heroes = completed_named_heroes()
    if args.list:
        for h in heroes:
            print(f"{slug(h['character_name']):<22} {h['id']}")
        return 0

    wanted = None if args.all else set(USED)
    written = skipped = 0

    for h in heroes:
        name = slug(h["character_name"])
        if wanted is not None and name not in wanted:
            continue
        base = f"{SITE}/api/files/{h['user_id']}/{h['id']}"
        try:
            # The drawing as photographed, and the hero it became. A creation
            # missing either half is not a pair and is no use here.
            drawing = fetch(f"{base}/original.jpg")
            hero = fetch(f"{base}/rendered.png")
        except Exception as exc:
            print(f"  --  {name}: {exc}")
            skipped += 1
            continue
        d = save(drawing, OUT / f"{name}-drawing.jpg")
        r = save(hero, OUT / f"{name}-hero.jpg")
        print(f"  OK  {name:<22} drawing {d // 1024:>4} KB   hero {r // 1024:>4} KB")
        written += 1

    print(f"\n{written} pair(s) in {OUT}" + (f", {skipped} skipped" if skipped else ""))
    if wanted is not None:
        missing = wanted - {slug(h["character_name"]) for h in heroes}
        if missing:
            print(f"NOT FOUND on the live site: {', '.join(sorted(missing))}")
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
