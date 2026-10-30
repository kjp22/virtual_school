"""Record the narration once, with one of two voice services.

Run on your own computer (needs internet), from the project folder.

Free Microsoft voices (edge-tts):
    pip install edge-tts
    python tools/make_voice.py

ElevenLabs (paid, more natural; uses your account's characters):
    python tools/make_voice.py --engine elevenlabs --list-voices
    python tools/make_voice.py --engine elevenlabs --voice-id <id>

Common options:
    --only c00        record only scenes whose name starts with this (c00 = intro)
    --force           re-record scenes that already have audio

Writes site/audio/<slug>.mp3 and site/audio/<slug>.json (word timings for the
captions), then rebuilds site/data/lessons.js.
"""
import argparse
import asyncio
import base64
import getpass
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AUDIO = ROOT / "site" / "audio"
sys.path.insert(0, str(ROOT / "tools"))
import build  # noqa: E402

UI_LINES = {
    "ui-right": "Μπράβο! Σωστά!",
    "ui-wrong": "Σχεδόν! Δοκίμασε ξανά.",
}

ELEVEN_API = "https://api.elevenlabs.io/v1"
ELEVEN_DEFAULT_VOICE = "EXAVITQu4vr4xnSDxMaL"  # "Sarah", a premade multilingual voice


def speech_text(lines):
    return " ".join(re.sub(r"\*\*", "", line) for line in lines)


def save(slug, audio_bytes, words):
    (AUDIO / f"{slug}.mp3").write_bytes(audio_bytes)
    (AUDIO / f"{slug}.json").write_text(json.dumps(words, ensure_ascii=False), encoding="utf-8")


# ---------- Microsoft (edge-tts) ----------

async def record_edge(text, slug, args):
    import edge_tts
    import edge_tts.communicate

    # edge-tts ignores SSL_CERT_FILE; honour it so recording works behind a proxy (e.g. a cloud session).
    if os.environ.get("SSL_CERT_FILE"):
        import ssl
        edge_tts.communicate._SSL_CTX = ssl.create_default_context(cafile=os.environ["SSL_CERT_FILE"])

    words, audio = [], bytearray()
    com = edge_tts.Communicate(text, args.voice, rate=args.rate, boundary="WordBoundary")
    async for chunk in com.stream():
        if chunk["type"] == "audio":
            audio.extend(chunk["data"])
        elif chunk["type"] == "WordBoundary":
            # Offsets come in 100-nanosecond ticks.
            words.append({
                "t": round(chunk["offset"] / 1e7, 3),
                "d": round(chunk["duration"] / 1e7, 3),
                "w": chunk["text"],
            })
    save(slug, bytes(audio), words)


# ---------- ElevenLabs ----------

def eleven_request(path, api_key, body=None):
    req = urllib.request.Request(
        ELEVEN_API + path,
        data=json.dumps(body).encode("utf-8") if body is not None else None,
        headers={"xi-api-key": api_key, "Content-Type": "application/json"},
        method="POST" if body is not None else "GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        sys.exit(f"ElevenLabs refused the request ({e.code}): {detail}")


def words_from_alignment(alignment):
    """ElevenLabs times every character; group them into words for the captions."""
    words, cur = [], None
    chars = alignment["characters"]
    starts = alignment["character_start_times_seconds"]
    ends = alignment["character_end_times_seconds"]
    for ch, start, end in zip(chars, starts, ends):
        if ch.isspace():
            if cur:
                words.append(cur)
            cur = None
            continue
        if cur is None:
            cur = {"t": round(start, 3), "d": 0, "w": ""}
        cur["w"] += ch
        cur["d"] = round(end - cur["t"], 3)
    if cur:
        words.append(cur)
    return words


def record_eleven(text, slug, args):
    body = {
        "text": text,
        "model_id": args.model,
        "voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "speed": args.speed},
    }
    path = f"/text-to-speech/{args.voice_id}/with-timestamps?output_format=mp3_44100_128"
    data = eleven_request(path, args.api_key, body)
    alignment = data.get("alignment") or data.get("normalized_alignment")
    save(slug, base64.b64decode(data["audio_base64"]), words_from_alignment(alignment) if alignment else [])


def list_eleven_voices(api_key):
    data = eleven_request("/voices", api_key)
    print("Voices on your ElevenLabs account (use the id with --voice-id):\n")
    for v in data.get("voices", []):
        labels = ", ".join(f"{k}: {val}" for k, val in (v.get("labels") or {}).items())
        print(f"  {v['voice_id']}  {v['name']}  ({labels})")
    print("\nAny voice with the multilingual model can speak Greek. Find more in the Voice Library on elevenlabs.io.")


# ---------- Main ----------

def collect_jobs(args):
    jobs = dict(UI_LINES)
    for path in sorted(build.SCRIPT_DIR.glob("*.md")):
        for scene in build.parse_file(path)["scenes"]:
            jobs[scene["slug"]] = speech_text(scene["narration"])
    return {
        slug: text for slug, text in jobs.items()
        if text
        and (not args.only or slug.startswith(args.only))
        and (args.force or not (AUDIO / f"{slug}.mp3").exists())
    }


async def main():
    parser = argparse.ArgumentParser(description="Record the lesson narration.")
    parser.add_argument("--engine", choices=["edge", "elevenlabs"], default="edge")
    parser.add_argument("--only", help="record only scenes whose name starts with this, e.g. c00 or c01-1-1")
    parser.add_argument("--force", action="store_true", help="re-record scenes that already have audio")
    parser.add_argument("--yes", action="store_true", help="don't ask before spending ElevenLabs characters")
    edge = parser.add_argument_group("Microsoft voices (edge)")
    edge.add_argument("--voice", default="el-GR-AthinaNeural", help="or el-GR-NestorasNeural")
    edge.add_argument("--rate", default="-8%", help="speaking speed, e.g. -10%% or +0%%")
    eleven = parser.add_argument_group("ElevenLabs")
    eleven.add_argument("--api-key", default=os.environ.get("ELEVENLABS_API_KEY"),
                        help="or set ELEVENLABS_API_KEY; asked for if missing")
    eleven.add_argument("--voice-id", default=ELEVEN_DEFAULT_VOICE)
    eleven.add_argument("--model", default="eleven_multilingual_v2", help="eleven_multilingual_v2 supports Greek")
    eleven.add_argument("--speed", type=float, default=0.95, help="0.7 (slow) to 1.2 (fast)")
    eleven.add_argument("--list-voices", action="store_true", help="show your ElevenLabs voices and stop")
    args = parser.parse_args()

    if args.engine == "elevenlabs" and not args.api_key:
        args.api_key = getpass.getpass("ElevenLabs API key (input is hidden): ").strip()
    if args.list_voices:
        list_eleven_voices(args.api_key)
        return

    AUDIO.mkdir(parents=True, exist_ok=True)
    jobs = collect_jobs(args)
    if not jobs:
        print("Nothing to record: every scene already has audio (use --force to re-record).")
        return

    chars = sum(len(t) for t in jobs.values())
    print(f"{len(jobs)} recordings, {chars:,} characters.")
    if args.engine == "elevenlabs" and not args.yes:
        if input(f"This uses about {chars:,} ElevenLabs characters. Continue? [y/N] ").strip().lower() != "y":
            print("Stopped. Nothing was recorded.")
            return

    for i, (slug, text) in enumerate(jobs.items(), 1):
        print(f"[{i}/{len(jobs)}] {slug}")
        if args.engine == "edge":
            await record_edge(text, slug, args)
        else:
            record_eleven(text, slug, args)

    subprocess.run([sys.executable, str(ROOT / "tools" / "build.py")], check=True)


if __name__ == "__main__":
    asyncio.run(main())
