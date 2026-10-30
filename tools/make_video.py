"""Make the animated clips with fal.ai (Kling video model).

Run on your own computer (needs internet), from the project folder.
Get a key at fal.ai → Dashboard → Keys. It costs money per clip (see the model's page on fal.ai).

Two kinds of clip:
    clip   your picture comes to life: site/img/<slug>.png (e.g. from Midjourney) → site/clip/<slug>.mp4
    bg     full-screen background made from the scene's "Φόντο" prompt → site/bg/<slug>.mp4

    python tools/make_video.py --only c00-0-1        try one scene first
    python tools/make_video.py                       every scene that has a picture (clip)
    python tools/make_video.py --kind bg             backgrounds too
    python tools/make_video.py --kind both

Other options:
    --only c00        only scenes whose name starts with this (c00 = intro)
    --force           make clips again even if they exist
    --seconds 10      longer clips (5 or 10)
    --model ...       another fal.ai video model id

Then rebuilds site/data/lessons.js.
"""
import argparse
import base64
import getpass
import json
import mimetypes
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
sys.path.insert(0, str(ROOT / "tools"))
import build  # noqa: E402

FAL_QUEUE = "https://queue.fal.run/"
CLIP_MODEL = "fal-ai/kling-video/v2.5-turbo/pro/image-to-video"
BG_MODEL = "fal-ai/kling-video/v2.5-turbo/pro/text-to-video"

STYLE = "children's animated storybook, soft warm colors, gentle smooth motion"
CLIP_MOTION = "subtle natural movement, blinking, breathing, camera almost still"
BG_MOTION = "slow calm motion that can loop, no people, no text"
NEGATIVE = "text, letters, watermark, scary, violent, blurry, distorted faces, extra limbs"


def fal_request(url, api_key, body=None):
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8") if body is not None else None,
        headers={"Authorization": f"Key {api_key}", "Content-Type": "application/json"},
        method="POST" if body is not None else "GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        hint = " Check your API key." if e.code in (401, 403) else ""
        sys.exit(f"fal.ai refused the request ({e.code}): {detail}{hint}")


def run_model(model, inputs, api_key):
    """Queue a job, wait for it, return the video URL."""
    job = fal_request(FAL_QUEUE + model, api_key, inputs)
    started = time.time()
    while True:
        status = fal_request(job["status_url"], api_key)["status"]
        if status == "COMPLETED":
            break
        print(f"    {status.lower().replace('_', ' ')}… {int(time.time() - started)}s", end="\r", flush=True)
        time.sleep(5)
    print()
    result = fal_request(job["response_url"], api_key)
    return result["video"]["url"]


def image_data_uri(path):
    mime = mimetypes.guess_type(path.name)[0] or "image/png"
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def clip_inputs(scene, args):
    picture = SITE / build.find_media("img", scene["slug"], [".webp", ".png", ".jpg"])
    # Older Kling versions call the picture image_url; newer ones start_image_url.
    image_key = "image_url" if any(v in args.model_clip for v in ("v1", "v2.1", "v2.5")) else "start_image_url"
    inputs = {
        "prompt": f"{scene['fg']}. {CLIP_MOTION}. {STYLE}",
        image_key: image_data_uri(picture),
        "duration": str(args.seconds),
        "negative_prompt": NEGATIVE,
    }
    if image_key == "start_image_url":
        inputs["generate_audio"] = False  # the narration is recorded separately
    return inputs


def bg_inputs(scene, args):
    inputs = {
        "prompt": f"{scene['bg']}. {BG_MOTION}. {STYLE}",
        "duration": str(args.seconds),
        "aspect_ratio": "16:9",
        "negative_prompt": NEGATIVE,
    }
    if not any(v in args.model_bg for v in ("v1", "v2.1", "v2.5")):
        inputs["generate_audio"] = False
    return inputs


def collect_jobs(args):
    jobs = []
    for path in sorted(build.SCRIPT_DIR.glob("*.md")):
        for scene in build.parse_file(path)["scenes"]:
            slug = scene["slug"]
            if args.only and not slug.startswith(args.only):
                continue
            if args.kind in ("clip", "both") and scene["img"] and (args.force or not scene["clip"]):
                jobs.append(("clip", scene))
            if args.kind in ("bg", "both") and scene["bg"] and (args.force or not scene["video"]):
                jobs.append(("bg", scene))
    return jobs


def main():
    parser = argparse.ArgumentParser(description="Make animated clips with fal.ai.")
    parser.add_argument("--kind", choices=["clip", "bg", "both"], default="clip",
                        help="clip = animate your pictures (default), bg = backgrounds")
    parser.add_argument("--only", help="only scenes whose name starts with this, e.g. c00 or c01-1-1")
    parser.add_argument("--force", action="store_true", help="make clips again even if they exist")
    parser.add_argument("--seconds", type=int, choices=[5, 10], default=5)
    parser.add_argument("--yes", action="store_true", help="don't ask before spending fal.ai credit")
    parser.add_argument("--api-key", default=os.environ.get("FAL_KEY") or os.environ.get("FAL_AI_API_KEY"),
                        help="or set FAL_KEY (or FAL_AI_API_KEY); asked for if missing")
    parser.add_argument("--model-clip", default=CLIP_MODEL)
    parser.add_argument("--model-bg", default=BG_MODEL)
    args = parser.parse_args()

    jobs = collect_jobs(args)
    if not jobs:
        if args.kind != "bg":
            print("Nothing to animate. Put pictures in site/img/ named after the scene (e.g. site/img/c00-0-1.png),")
            print("or use --kind bg for backgrounds. Use --force to redo clips that already exist.")
        else:
            print("Nothing to make: every scene already has a background (use --force to redo).")
        return

    print(f"{len(jobs)} clips of {args.seconds}s each:")
    for kind, scene in jobs:
        print(f"  {scene['slug']}  {kind}")
    if not args.yes:
        print("Each clip costs money on fal.ai (about $0.35 for 5s with the default model; check fal.ai for today's price).")
        if input("Continue? [y/N] ").strip().lower() != "y":
            print("Stopped. Nothing was made.")
            return
    if not args.api_key:
        args.api_key = getpass.getpass("fal.ai API key (input is hidden): ").strip()

    for i, (kind, scene) in enumerate(jobs, 1):
        slug = scene["slug"]
        print(f"[{i}/{len(jobs)}] {slug} ({kind})")
        if kind == "clip":
            url = run_model(args.model_clip, clip_inputs(scene, args), args.api_key)
            out = SITE / "clip" / f"{slug}.mp4"
        else:
            url = run_model(args.model_bg, bg_inputs(scene, args), args.api_key)
            out = SITE / "bg" / f"{slug}.mp4"
        out.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(url, timeout=300) as resp:
            out.write_bytes(resp.read())
        print(f"    saved {out.relative_to(ROOT)}")

    subprocess.run([sys.executable, str(ROOT / "tools" / "build.py")], check=True)


if __name__ == "__main__":
    main()
