# Virtual School — Ταξίδι στα Βυζαντινά Χρόνια

An interactive, narrated study aid (βοήθημα) for 5th-grade Greek history (Ε΄ Δημοτικού).

- Original text, written from general historical knowledge. No text, images or exercises are taken from the official school textbook.
- Follows the topics of the official curriculum.
- Independent project; not affiliated with the Ministry of Education or ITYE "Diophantus".

## Structure

```
script/
  00-eisagogi.md              Intro
  01-ellines-kai-romaioi.md   Chapter 1: Greeks and Romans
```

Each scene in a script has:
- **Φόντο** – background animation (English prompt for a video tool, or a simple coded effect)
- **Μπροστά** – our own foreground illustration (English prompt for an image tool)
- **Αφήγηση** – narration text, also shown as captions

## Player

```
site/
  index.html, style.css, app.js   the lesson player
  background.js                   coded background animations (used when there is no video clip)
  clip/                           animated pictures (tools/make_video.py)
  data/lessons.js                 generated from script/ by tools/build.py — don't edit by hand
```

Open `site/index.html` in a browser. Best in **Microsoft Edge** (it has natural Greek voices built in).
Until the narration is recorded, the player uses the browser's own Greek voice.

## Workflow

1. Edit a script in `script/`, then rebuild:
   ```
   python tools/build.py
   ```
2. Record the narration once (on your own computer, free):
   ```
   pip install edge-tts
   python tools/make_voice.py
   ```
3. Add pictures and clips named after the scene (press **ⓘ** in the player to see each scene's name and prompts):
   - `site/img/c01-1-3.webp` – foreground picture
   - `site/bg/c01-1-3.mp4` – background clip

   Then run `python tools/build.py` again.
4. Bring the pictures to life with fal.ai (paid, about $0.35 per 5-second clip):
   ```
   python tools/make_video.py --only c00-0-1
   ```
   It asks for your fal.ai key, animates `site/img/<scene>.png` into `site/clip/<scene>.mp4`,
   and the player shows the moving clip instead of the still picture.
   Leave out `--only` to do every scene with a picture; add `--kind bg` for backgrounds.

   Midjourney tips: use `--ar 4:3` (the picture frame's shape), and give every picture the same
   owl reference image so Glafki looks the same everywhere.

Keys: Space = play/pause, ← → = scenes, C = captions, I = production notes, F = fullscreen.
