"""Make the scene pictures with fal.ai (Nano Banana Pro), instead of Midjourney.

Reads the prompts in prompts/midjourney-*.md and saves site/img/<slug>.png.
The first picture of each file is the owl (Glafki); scenes marked "(+ owl reference)"
get that picture as a reference, so she looks the same everywhere.

    python tools/make_images.py --only c00          the intro
    python tools/make_images.py --only c00-0-1      one picture
    python tools/make_images.py --force             make pictures again even if they exist

Needs FAL_KEY or FAL_AI_API_KEY. Costs about $0.15 per picture (check fal.ai for today's price).
"""
import argparse
import os
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from make_video import fal_request, image_data_uri, FAL_QUEUE  # noqa: E402
import time  # noqa: E402

IMG_DIR = ROOT / "site" / "img"
TEXT_MODEL = "fal-ai/nano-banana-pro"
EDIT_MODEL = "fal-ai/nano-banana-pro/edit"
NO_TEXT = "No text, letters or writing anywhere in the picture."
SAME_OWL = "Keep the owl exactly as in the reference picture: same face, eyes, feathers, satchel and style."

SCENE_RE = re.compile(r"\*\*(c\d\d-[\d-]+)\*\*([^\n]*)\n```\n(.*?)\n```", re.S)


def read_prompts(path):
    """[(slug, prompt, uses_owl_reference, aspect_ratio)] in file order."""
    scenes = []
    for slug, title, prompt in SCENE_RE.findall(path.read_text(encoding="utf-8")):
        ar = re.search(r"--ar (\d+:\d+)", prompt)
        prompt = re.sub(r"\s*--\w+ \S+", "", prompt).strip()
        scenes.append((slug, prompt, "owl reference" in title, ar.group(1) if ar else "4:3"))
    return scenes


def run_model(model, inputs, api_key):
    """Queue a job, wait for it, return the picture URL."""
    job = fal_request(FAL_QUEUE + model, api_key, inputs)
    while fal_request(job["status_url"], api_key)["status"] != "COMPLETED":
        time.sleep(3)
    return fal_request(job["response_url"], api_key)["images"][0]["url"]


def main():
    parser = argparse.ArgumentParser(description="Make scene pictures with fal.ai.")
    parser.add_argument("--only", help="only scenes whose name starts with this, e.g. c00")
    parser.add_argument("--force", action="store_true", help="make pictures again even if they exist")
    parser.add_argument("--api-key", default=os.environ.get("FAL_KEY") or os.environ.get("FAL_AI_API_KEY"))
    args = parser.parse_args()
    if not args.api_key:
        sys.exit("Set FAL_KEY or FAL_AI_API_KEY first.")

    IMG_DIR.mkdir(parents=True, exist_ok=True)
    for path in sorted((ROOT / "prompts").glob("midjourney-*.md")):
        scenes = read_prompts(path)
        owl = IMG_DIR / f"{scenes[0][0]}.png" if scenes else None
        for slug, prompt, ref, ar in scenes:
            out = IMG_DIR / f"{slug}.png"
            if args.only and not slug.startswith(args.only):
                continue
            if out.exists() and not args.force:
                continue
            print(f"{slug} …", flush=True)
            inputs = {"prompt": f"{prompt}. {NO_TEXT}", "aspect_ratio": ar, "output_format": "png"}
            if ref:
                if not owl.exists():
                    sys.exit(f"Make {owl.name} first: it is the owl reference.")
                inputs["prompt"] += " " + SAME_OWL
                inputs["image_urls"] = [image_data_uri(owl)]
                url = run_model(EDIT_MODEL, inputs, args.api_key)
            else:
                url = run_model(TEXT_MODEL, inputs, args.api_key)
            with urllib.request.urlopen(url, timeout=300) as resp:
                out.write_bytes(resp.read())
            print(f"    saved {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
