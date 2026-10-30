"""Turn the Markdown scripts in script/ into site/data/lessons.js for the player.

Run after editing a script or adding media:
    python tools/build.py

Optional media, picked up automatically if present (named by scene slug, e.g. c01-1-3):
    site/img/<id>.webp|.png|.jpg   foreground illustration
    site/clip/<id>.mp4|.webm        the foreground picture, animated (tools/make_video.py)
    site/bg/<id>.mp4|.webm          background animation clip
    site/audio/<id>.mp3 + <id>.json recorded narration + word timings (tools/make_voice.py)
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT_DIR = ROOT / "script"
SITE = ROOT / "site"

SCENE_RE = re.compile(r"^## Σκηνή (\S+) — (.+)$")
STATION_RE = re.compile(r"^# (Σταθμός (\d+) — .+|Επίλογος.*)$")
FIELD_RE = re.compile(r"^\*\*(Φόντο|Μπροστά):\*\*\s*`([^`]+)`(?:\s*\*\((.+)\)\*)?")
QUESTION_RE = re.compile(r"^\*\*(?:Μπόνους )?[Εε]ρώτηση(?: \(([^)]+)\))?:\*\*\s*(.*)$")
FEEDBACK_RE = re.compile(r"^\*\*Αν (απαντήσει σωστά|κάνει λάθος):\*\*\s*(.+)$")
CHOICE_RE = re.compile(r"^- (.+)$")
TF_RE = re.compile(r"^\d+\. (.+?) — \*\*(Σωστό|Λάθος)\*\*")
MATCH_RE = re.compile(r"^- (.+?) → (.+)$")


def scene_slug(chapter_id, scene_id):
    # Scene ids repeat across chapters (each chapter has a 1.1), so prefix the chapter number.
    return f"c{chapter_id[:2]}-" + scene_id.replace(".", "-").replace("Ε", "end")


def clean_line(line):
    """Strip Markdown italics/asides; keep **bold** markers for the captions."""
    line = re.sub(r"^\*\((.+)\)\*$", r"\1", line.strip())
    return line.replace("*(", "").replace(")*", "")


def find_media(folder, slug, exts):
    for ext in exts:
        path = SITE / folder / f"{slug}{ext}"
        if path.exists():
            return f"{folder}/{slug}{ext}"
    return None


def parse_question(kind, prompt):
    kind = (kind or "").lower()
    if "ταίριασμα" in kind:
        qtype = "match"
    elif "σωστό" in kind:
        qtype = "truefalse"
    else:
        qtype = "choice"
    return {"type": qtype, "prompt": prompt.strip(), "items": []}


def parse_file(path):
    lines = path.read_text(encoding="utf-8").splitlines()
    chapter = {"id": path.stem, "title": "", "scenes": []}
    station = None
    scene = None
    question = None
    in_narration = False

    for raw in lines:
        line = raw.rstrip()
        if not chapter["title"] and line.startswith("# "):
            chapter["title"] = line[2:].strip()
            continue
        m = STATION_RE.match(line)
        if m:
            station = m.group(1)
            scene = None
            continue
        m = SCENE_RE.match(line)
        if m:
            scene = {
                "id": m.group(1),
                "slug": scene_slug(path.stem, m.group(1)),
                "title": m.group(2).strip(),
                "station": station,
                "bg": "",
                "fg": "",
                "narration": [],
                "questions": [],
            }
            chapter["scenes"].append(scene)
            question = None
            in_narration = False
            continue
        if scene is None:
            continue
        if line.startswith("---"):
            in_narration = False
            continue
        m = FIELD_RE.match(line)
        if m:
            scene["bg" if m.group(1) == "Φόντο" else "fg"] = m.group(2)
            in_narration = False
            continue
        if line.startswith("**Αφήγηση:**"):
            in_narration = True
            continue
        m = QUESTION_RE.match(line)
        if m:
            question = parse_question(m.group(1), m.group(2))
            scene["questions"].append(question)
            in_narration = False
            continue
        m = FEEDBACK_RE.match(line)
        if m and question:
            key = "right" if m.group(1) == "απαντήσει σωστά" else "wrong"
            question[key] = m.group(2).strip()
            continue
        if in_narration and line.strip():
            scene["narration"].append(clean_line(line))
            continue
        if question and line.strip():
            if question["type"] == "truefalse":
                m = TF_RE.match(line)
                if m:
                    question["items"].append({"text": m.group(1), "answer": m.group(2) == "Σωστό"})
            elif question["type"] == "match":
                m = MATCH_RE.match(line)
                if m:
                    question["items"].append({"left": m.group(1), "right": m.group(2)})
            else:
                m = CHOICE_RE.match(line)
                if m:
                    text = m.group(1)
                    correct = "✅" in text
                    text = text.replace("✅", "").replace("**", "").strip()
                    text = re.sub(r"^[α-ω]\) ", "", text)
                    question["items"].append({"text": text, "correct": correct})

    for scene in chapter["scenes"]:
        # Quiz-only scenes: Glafki reads the questions aloud.
        if not scene["narration"] and scene["questions"]:
            scene["narration"] = [q["prompt"] for q in scene["questions"] if q["prompt"]]
        slug = scene["slug"]
        scene["img"] = find_media("img", slug, [".webp", ".png", ".jpg"])
        scene["clip"] = find_media("clip", slug, [".webm", ".mp4"])
        scene["video"] = find_media("bg", slug, [".webm", ".mp4"])
        audio = find_media("audio", slug, [".mp3"])
        timings = SITE / "audio" / f"{slug}.json"
        scene["audio"] = audio
        scene["words"] = json.loads(timings.read_text(encoding="utf-8")) if audio and timings.exists() else None
    return chapter


def main():
    chapters = [parse_file(p) for p in sorted(SCRIPT_DIR.glob("*.md"))]
    ui_audio = {k: find_media("audio", f"ui-{k}", [".mp3"]) for k in ("right", "wrong")}
    data = {"chapters": chapters, "uiAudio": ui_audio}
    out = SITE / "data" / "lessons.js"
    out.parent.mkdir(parents=True, exist_ok=True)
    # A .js file (not .json) so the page also works when opened straight from disk.
    out.write_text("window.LESSONS = " + json.dumps(data, ensure_ascii=False, indent=1) + ";\n", encoding="utf-8")
    scenes = sum(len(c["scenes"]) for c in chapters)
    print(f"Wrote {out.relative_to(ROOT)}: {len(chapters)} chapters, {scenes} scenes")


if __name__ == "__main__":
    main()
