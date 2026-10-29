"""Record the narration once with Microsoft's free neural voices (edge-tts).

Run on your own computer (needs internet):
    pip install edge-tts
    python tools/make_voice.py            # records only scenes that have no audio yet
    python tools/make_voice.py --force    # re-records everything

Writes site/audio/<slug>.mp3 and site/audio/<slug>.json (word timings for the
captions), then rebuilds site/data/lessons.js.
"""
import argparse
import asyncio
import json
import re
import subprocess
import sys
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parent.parent
AUDIO = ROOT / "site" / "audio"
sys.path.insert(0, str(ROOT / "tools"))
import build  # noqa: E402

UI_LINES = {
    "ui-right": "Μπράβο! Σωστά!",
    "ui-wrong": "Σχεδόν! Δοκίμασε ξανά.",
}


def speech_text(lines):
    return " ".join(re.sub(r"\*\*", "", line) for line in lines)


async def record(text, slug, voice, rate):
    words = []
    com = edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary")
    with open(AUDIO / f"{slug}.mp3", "wb") as audio:
        async for chunk in com.stream():
            if chunk["type"] == "audio":
                audio.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                # Offsets come in 100-nanosecond ticks.
                words.append({
                    "t": round(chunk["offset"] / 1e7, 3),
                    "d": round(chunk["duration"] / 1e7, 3),
                    "w": chunk["text"],
                })
    (AUDIO / f"{slug}.json").write_text(json.dumps(words, ensure_ascii=False), encoding="utf-8")


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--voice", default="el-GR-AthinaNeural", help="or el-GR-NestorasNeural")
    parser.add_argument("--rate", default="-8%", help="speaking speed, e.g. -10%% or +0%%")
    parser.add_argument("--force", action="store_true", help="re-record existing audio")
    args = parser.parse_args()
    AUDIO.mkdir(parents=True, exist_ok=True)

    jobs = dict(UI_LINES)
    for path in sorted(build.SCRIPT_DIR.glob("*.md")):
        for scene in build.parse_file(path)["scenes"]:
            jobs[scene["slug"]] = speech_text(scene["narration"])

    for slug, text in jobs.items():
        if not text or ((AUDIO / f"{slug}.mp3").exists() and not args.force):
            continue
        print(f"Recording {slug} ...")
        await record(text, slug, args.voice, args.rate)

    subprocess.run([sys.executable, str(ROOT / "tools" / "build.py")], check=True)


if __name__ == "__main__":
    asyncio.run(main())
