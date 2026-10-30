// Lesson player: shows each scene's background, picture and captions, plays the narration,
// then runs the quiz (if any) and moves on.
(function () {
  const DATA = window.LESSONS || { chapters: [], uiAudio: {} };
  const $ = (sel) => document.querySelector(sel);
  const el = {
    fg: $("#fg"), img: $("#fg-img"), clip: $("#fg-video"), placeholder: $("#fg-placeholder"), note: $("#fg-note"),
    video: $("#bg-video"), captions: $("#captions"), station: $("#station-chip"), progress: $("#progress"),
    titleCard: $("#title-card"), quiz: $("#quiz"), home: $("#home"), chapterList: $("#chapter-list"),
    voiceStatus: $("#voice-status"), play: $("#btn-play"), cc: $("#btn-cc"), info: $("#btn-info"),
  };

  const AFTER_SCENE_PAUSE = 1200;
  const TITLE_CARD_TIME = 2600;

  const state = { chapter: null, chapterIdx: 0, index: 0, playing: false, run: 0, engine: null, lineIdx: 0 };

  // ---------- Storage (a convenience only; the page works without it) ----------
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  };

  // ---------- Text helpers ----------
  // "Η **Κωνσταντινούπολη**." -> [{text:"Η", key:false}, {text:"Κωνσταντινούπολη.", key:true}]
  function tokenize(line) {
    const tokens = [];
    line.split(/(\*\*[^*]+\*\*)/).forEach((part) => {
      const key = part.startsWith("**");
      part.replace(/\*\*/g, "").split(/\s+/).filter(Boolean).forEach((text) => tokens.push({ text, key }));
    });
    return tokens;
  }
  const plain = (line) => line.replace(/\*\*/g, "");
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]/gu, "");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- Captions ----------
  let captionSpans = [];
  function showLine(line) {
    el.captions.innerHTML = "";
    const box = document.createElement("span");
    box.className = "line";
    captionSpans = tokenize(line).map((tok, i) => {
      const s = document.createElement("span");
      s.className = "w" + (tok.key ? " key" : "");
      s.textContent = tok.text;
      if (i) box.append(" ");
      box.append(s);
      return s;
    });
    el.captions.append(box);
  }
  function markSaid(upTo) {
    captionSpans.forEach((s, i) => s.classList.toggle("said", i <= upTo));
  }

  // ---------- Voices ----------
  let greekVoice = null;
  function pickGreekVoice() {
    const voices = (window.speechSynthesis && speechSynthesis.getVoices()) || [];
    const greek = voices.filter((v) => /^el(-|_|$)/i.test(v.lang));
    const score = (v) => (/natural|online|neural/i.test(v.name) ? 4 : 0) + (/athina|melina|google/i.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1);
    greekVoice = greek.sort((a, b) => score(b) - score(a))[0] || null;
    updateVoiceStatus();
  }
  if (window.speechSynthesis) {
    pickGreekVoice();
    speechSynthesis.addEventListener?.("voiceschanged", pickGreekVoice);
  }
  function hasRecordedAudio() {
    return DATA.chapters.some((c) => c.scenes.some((s) => s.audio));
  }
  function updateVoiceStatus() {
    if (hasRecordedAudio()) el.voiceStatus.textContent = "🎙️ Φωνή: ηχογραφημένη αφήγηση";
    else if (greekVoice) el.voiceStatus.textContent = `🔊 Φωνή: ${greekVoice.name} (προσωρινή, από τον browser)`;
    else el.voiceStatus.textContent = "🔇 Δεν βρέθηκε ελληνική φωνή σε αυτόν τον browser — θα δεις μόνο υπότιτλους. Δοκίμασε Microsoft Edge ή Safari.";
  }

  // Each engine plays one scene's lines and reports back: onLine(i), onWord(i), onEnd().
  function RecordedEngine(scene, cb) {
    const lines = scene.narration;
    const tokens = [];
    lines.forEach((line, li) => tokenize(line).forEach((t, wi) => tokens.push({ li, wi, n: norm(t.text) })));
    const times = new Array(tokens.length).fill(null);
    let j = 0;
    for (const w of scene.words) {
      const n = norm(w.w);
      if (!n) continue;
      for (let k = j; k < Math.min(j + 4, tokens.length); k++) {
        const tn = tokens[k].n;
        if (tn && (tn === n || tn.startsWith(n) || n.startsWith(tn))) { times[k] = w.t; j = k + 1; break; }
      }
    }
    let prev = 0;
    for (let i = 0; i < times.length; i++) { if (times[i] == null) times[i] = prev; else prev = times[i]; }

    const audio = new Audio(scene.audio);
    let raf = 0, curLine = -1;
    function tick() {
      const t = audio.currentTime + 0.05;
      let k = -1;
      while (k + 1 < times.length && times[k + 1] <= t) k++;
      const tok = tokens[Math.max(k, 0)];
      if (tok && tok.li !== curLine) { curLine = tok.li; cb.onLine(curLine); }
      if (k >= 0) cb.onWord(tok.wi);
      raf = requestAnimationFrame(tick);
    }
    audio.addEventListener("ended", () => { cancelAnimationFrame(raf); cb.onEnd(); });
    return {
      start() { curLine = -1; audio.play().catch(() => cb.onBlocked()); raf = requestAnimationFrame(tick); },
      pause() { audio.pause(); cancelAnimationFrame(raf); },
      resume() { audio.play(); raf = requestAnimationFrame(tick); },
      stop() { audio.pause(); cancelAnimationFrame(raf); },
    };
  }

  // Browser speech (or silent captions when there is no Greek voice). Speaks line by line.
  function SpeechEngine(scene, cb) {
    const lines = scene.narration;
    let li = 0, gen = 0, timer = 0, boundarySeen = false;
    const useVoice = !!(greekVoice && window.speechSynthesis);

    function playLine() {
      const my = ++gen;
      if (li >= lines.length) { cb.onEnd(); return; }
      cb.onLine(li);
      const text = plain(lines[li]);
      const toks = tokenize(lines[li]);
      const starts = [];
      let pos = 0;
      toks.forEach((t) => { pos = text.indexOf(t.text, pos); starts.push(pos); pos += t.text.length; });
      const estimate = (ms) => Math.min(toks.length - 1, Math.floor((ms / 1000) * 2.6));
      const began = performance.now();
      clearInterval(timer);
      timer = setInterval(() => { if (!boundarySeen) cb.onWord(estimate(performance.now() - began)); }, 90);
      const next = () => { if (my !== gen) return; clearInterval(timer); cb.onWord(toks.length - 1); li++; setTimeout(playLine, 250); };

      if (!useVoice) {
        setTimeout(next, 900 + toks.length * 380);
        return;
      }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "el-GR";
      u.voice = greekVoice;
      u.rate = 0.95;
      u.onboundary = (e) => {
        if (e.name && e.name !== "word") return;
        boundarySeen = true;
        let k = 0;
        while (k + 1 < starts.length && starts[k + 1] <= e.charIndex) k++;
        cb.onWord(k);
      };
      u.onend = next;
      u.onerror = next;
      SpeechEngine.current = u; // keep a reference: Chrome drops events of collected utterances
      speechSynthesis.speak(u);
    }
    const halt = () => { gen++; clearInterval(timer); if (useVoice) speechSynthesis.cancel(); };
    return {
      start() { li = 0; playLine(); },
      pause: halt,
      resume() { playLine(); }, // restarts the current line
      stop: halt,
    };
  }

  function makeEngine(scene, cb) {
    return scene.audio && scene.words ? RecordedEngine(scene, cb) : SpeechEngine(scene, cb);
  }

  let uiAudioCache = {};
  function sayFeedback(kind) {
    const src = DATA.uiAudio && DATA.uiAudio[kind];
    if (src) {
      const a = (uiAudioCache[kind] = uiAudioCache[kind] || new Audio(src));
      a.currentTime = 0;
      a.play().catch(() => {});
    } else if (greekVoice) {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(kind === "right" ? "Μπράβο!" : "Δοκίμασε ξανά.");
      u.voice = greekVoice;
      u.lang = "el-GR";
      speechSynthesis.speak(u);
    }
  }

  // ---------- Pictures ----------
  const PICTURES = [
    [/hourglass/i, "⏳"], [/owl/i, "🦉"], [/timeline/i, "📅"], [/map/i, "🗺️"], [/city|domes/i, "🏰"],
    [/eagle|standard/i, "🦅"], [/legion|soldier|general/i, "⚔️"], [/statue|temple|column|goddess/i, "🏛️"],
    [/scroll|seal/i, "📜"], [/family|farming/i, "👨‍👩‍👧"], [/donkey/i, "🫏"], [/emperor/i, "👑"],
    [/teenage|boy/i, "👦"], [/girl/i, "👧"], [/older|bearded|teacher/i, "🧔"], [/cards|god name/i, "⚡"],
    [/wax tablet|stylus/i, "✍️"], [/coin/i, "🪙"], [/road|cross-section/i, "🛣️"], [/milestone|traveler|horseback/i, "🐎"],
    [/chariot/i, "🏇"], [/pools|bath/i, "♨️"], [/apartment|house|cutaway/i, "🏘️"], [/reclining|bread|olives|figs/i, "🍇"],
    [/knucklebones|doll/i, "🦴"], [/badges/i, "🏅"], [/question/i, "❓"], [/icons/i, "👂"],
  ];
  function pictureFor(prompt) {
    const found = [];
    for (const [re, glyph] of PICTURES) {
      if (re.test(prompt) && !found.includes(glyph)) found.push(glyph);
      if (found.length === 2) break;
    }
    return found.length ? found : ["🦉"];
  }

  function setVisuals(scene) {
    window.Background.set(scene.bg);
    if (scene.video) {
      el.video.src = scene.video;
      el.video.play().catch(() => {});
      el.video.classList.add("show");
    } else {
      el.video.classList.remove("show");
      el.video.removeAttribute("src");
    }
    // The animated clip of the picture wins over the still picture. It plays once, then its
    // last frame stays and slowly zooms while the narration finishes (a loop gets tiring).
    el.clip.hidden = !scene.clip;
    el.clip.classList.remove("held");
    if (scene.clip) {
      el.clip.onended = () => el.clip.classList.add("held");
      el.clip.src = scene.clip;
      el.clip.play().catch(() => {});
    } else {
      el.clip.removeAttribute("src");
    }
    if (scene.clip) {
      el.img.hidden = true;
      el.placeholder.hidden = true;
    } else if (scene.img) {
      el.img.src = scene.img;
      el.img.hidden = false;
      el.placeholder.hidden = true;
    } else {
      el.img.hidden = true;
      el.placeholder.hidden = false;
      el.placeholder.innerHTML = pictureFor(scene.fg || "").map((g) => `<span>${g}</span>`).join("");
    }
    el.note.innerHTML =
      `<b>Σκηνή ${scene.id}</b> · ${scene.slug}<br>` +
      (scene.bg ? `<b>Φόντο:</b> ${escapeHtml(scene.bg)}<br>` : "") +
      (scene.fg ? `<b>Εικόνα:</b> ${escapeHtml(scene.fg)}` : "");
    el.station.textContent = scene.station || state.chapter.title;
    renderProgress();
  }
  const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function renderProgress() {
    el.progress.innerHTML = "";
    state.chapter.scenes.forEach((s, i) => {
      const dot = document.createElement("i");
      dot.className = (i < state.index ? "done" : i === state.index ? "now" : "") + (s.questions.length ? " quiz" : "");
      dot.title = `${s.id} — ${s.title}`;
      dot.onclick = () => goto(i);
      el.progress.append(dot);
    });
  }

  // ---------- Flow ----------
  function stopEngine() {
    if (state.engine) state.engine.stop();
    state.engine = null;
  }

  async function goto(i, opts = {}) {
    const run = ++state.run;
    stopEngine();
    el.quiz.hidden = true;
    el.titleCard.hidden = true;
    const scenes = state.chapter.scenes;
    if (i >= scenes.length) return showChapterEnd();
    state.index = Math.max(0, i);
    const scene = scenes[state.index];
    location.replace(`#ch${state.chapterIdx}-${state.index}`);
    store.set("vs-pos", `ch${state.chapterIdx}-${state.index}`);

    el.fg.classList.add("leaving");
    const card = titleCardFor(state.index);
    if (state.playing && card && !opts.skipTitle) {
      showTitleCard(card.eyebrow, card.title);
      setVisuals(scene);
      await sleep(TITLE_CARD_TIME);
      if (run !== state.run) return;
      el.titleCard.hidden = true;
    } else {
      await sleep(250);
      if (run !== state.run) return;
      setVisuals(scene);
    }
    el.fg.classList.remove("leaving");
    showLine(scene.narration[0] || "");
    state.lineIdx = 0;

    state.engine = makeEngine(scene, {
      onLine(li) { if (run === state.run) { state.lineIdx = li; showLine(scene.narration[li]); } },
      onWord(wi) { if (run === state.run) markSaid(wi); },
      onBlocked() { if (run === state.run) setPlaying(false); },
      async onEnd() {
        if (run !== state.run) return;
        state.engine = null;
        if (scene.questions.length) return showQuiz(scene, run);
        await sleep(AFTER_SCENE_PAUSE);
        if (run === state.run && state.playing) goto(state.index + 1);
      },
    });
    if (state.playing) {
      state.engine.start();
      state.engine.started = true;
    }
  }

  // A title card opens each chapter and each new station.
  function titleCardFor(i) {
    const scenes = state.chapter.scenes;
    const scene = scenes[i];
    const [stEyebrow, stTitle] = (scene.station || "").split(" — ");
    if (i === 0) {
      const { name, sub } = chapterParts(state.chapter);
      return stTitle ? { eyebrow: `${name} · ${stEyebrow}`, title: stTitle } : { eyebrow: name, title: sub || name };
    }
    if (scene.station && scenes[i - 1].station !== scene.station) {
      return stTitle ? { eyebrow: stEyebrow, title: stTitle } : { eyebrow: "", title: stEyebrow };
    }
    return null;
  }

  function showTitleCard(eyebrow, title) {
    el.titleCard.querySelector(".eyebrow").textContent = eyebrow;
    el.titleCard.querySelector("h2").textContent = title;
    el.titleCard.hidden = false;
  }

  function showChapterEnd() {
    stopEngine();
    const next = DATA.chapters[state.chapterIdx + 1];
    el.captions.innerHTML = "";
    el.quiz.hidden = false;
    el.quiz.innerHTML = `
      <div class="q-head"><span>🏅</span><h3>Τέλος! Τελείωσες το «${escapeHtml(chapterParts(state.chapter).name)}».</h3></div>
      <p class="feedback right">Η Γλαύκη είναι πολύ περήφανη για σένα!</p>
      ${next ? `<button class="q-next" data-act="next">Επόμενο: ${escapeHtml(chapterParts(next).name)} ➜</button>` : ""}
      <button class="q-next" data-act="home" style="background:transparent;color:var(--ink);border:1px solid var(--panel-line)">Αρχική</button>`;
    el.quiz.onclick = (e) => {
      const act = e.target.dataset.act;
      if (act === "next") openChapter(state.chapterIdx + 1, 0);
      if (act === "home") goHome();
    };
  }

  function setPlaying(on) {
    state.playing = on;
    el.play.textContent = on ? "⏸" : "▶";
    document.body.classList.toggle("paused", !on);
  }

  function togglePlay() {
    if (!el.quiz.hidden) return;
    if (state.playing) {
      setPlaying(false);
      if (state.engine) state.engine.pause();
    } else {
      setPlaying(true);
      if (state.engine) {
        state.engine.started ? state.engine.resume() : state.engine.start();
        state.engine.started = true;
      } else goto(state.index);
    }
  }

  // ---------- Quiz ----------
  function showQuiz(scene, run) {
    el.quiz.hidden = false;
    el.captions.innerHTML = "";
    el.fg.classList.add("leaving");
    el.quiz.onclick = null;
    el.quiz.innerHTML = "";
    let remaining = scene.questions.length;
    const doneOne = () => {
      if (--remaining === 0) {
        const btn = document.createElement("button");
        btn.className = "q-next";
        btn.textContent = "Συνέχεια ➜";
        btn.onclick = () => { if (run === state.run) goto(state.index + 1); };
        el.quiz.append(btn);
        btn.focus();
      }
    };
    scene.questions.forEach((q, qi) => {
      const block = document.createElement("div");
      block.className = "q-block";
      block.innerHTML = `<div class="q-head">${qi === 0 ? "<span>🦉</span>" : ""}<h3>${escapeHtml(q.prompt || "Η Γλαύκη ρωτάει…")}</h3></div>`;
      const fb = document.createElement("p");
      fb.className = "feedback";
      const feedback = (ok, text) => {
        fb.className = "feedback " + (ok ? "right" : "wrong");
        fb.textContent = text || (ok ? "Μπράβο! Σωστά!" : "Σχεδόν! Δοκίμασε ξανά.");
        sayFeedback(ok ? "right" : "wrong");
      };
      if (q.type === "choice") block.append(choiceQuiz(q, feedback, doneOne));
      else if (q.type === "truefalse") block.append(trueFalseQuiz(q, feedback, doneOne));
      else block.append(matchQuiz(q, feedback, doneOne));
      block.append(fb);
      el.quiz.append(block);
    });
  }

  function button(text, cls = "opt") {
    const b = document.createElement("button");
    b.className = cls;
    b.textContent = text;
    return b;
  }

  function choiceQuiz(q, feedback, done) {
    const wrap = document.createElement("div");
    wrap.className = "opts";
    const btns = q.items.map((item) => {
      const b = button(item.text);
      b.onclick = () => {
        if (item.correct) {
          b.classList.add("right");
          btns.forEach((o) => { o.disabled = true; if (o !== b) o.classList.add("faded"); });
          feedback(true, q.right);
          done();
        } else {
          b.classList.add("wrong");
          b.disabled = true;
          feedback(false, q.wrong);
        }
      };
      wrap.append(b);
      return b;
    });
    return wrap;
  }

  function trueFalseQuiz(q, feedback, done) {
    const wrap = document.createElement("div");
    wrap.className = "opts";
    let left = q.items.length;
    q.items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "tf-row";
      const p = document.createElement("p");
      p.textContent = item.text;
      row.append(p);
      const pair = [["Σωστό", true], ["Λάθος", false]].map(([label, value]) => {
        const b = button(label);
        b.onclick = () => {
          if (value === item.answer) {
            b.classList.add("right");
            pair.forEach((o) => (o.disabled = true));
            feedback(true, --left === 0 ? "Μπράβο! Τα βρήκες όλα!" : "Σωστά!");
            if (left === 0) done();
          } else {
            b.classList.add("wrong");
            b.disabled = true;
            feedback(false);
          }
        };
        row.append(b);
        return b;
      });
      wrap.append(row);
    });
    return wrap;
  }

  function matchQuiz(q, feedback, done) {
    const wrap = document.createElement("div");
    wrap.className = "match";
    const leftCol = document.createElement("div");
    const rightCol = document.createElement("div");
    leftCol.className = rightCol.className = "col";
    let picked = null, left = q.items.length;
    q.items.forEach((item) => {
      const b = button(item.left);
      b.onclick = () => {
        if (picked) picked.btn.classList.remove("picked");
        picked = { btn: b, item };
        b.classList.add("picked");
      };
      leftCol.append(b);
    });
    shuffle(q.items.slice()).forEach((item) => {
      const b = button(item.right);
      b.onclick = () => {
        if (!picked) { feedback(false, "Διάλεξε πρώτα έναν θεό από αριστερά."); return; }
        if (picked.item === item) {
          picked.btn.classList.replace("picked", "right");
          b.classList.add("right");
          picked.btn.disabled = b.disabled = true;
          picked = null;
          feedback(true, --left === 0 ? "Μπράβο! Τα ταίριαξες όλα!" : "Σωστό ζευγάρι!");
          if (left === 0) done();
        } else {
          b.classList.add("wrong");
          setTimeout(() => b.classList.remove("wrong"), 400);
          feedback(false);
        }
      };
      rightCol.append(b);
    });
    wrap.append(leftCol, rightCol);
    return wrap;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    // Never leave the answers in the same order as the questions.
    return arr.length > 1 && arr.every((x, i) => x === arr[i]) ? arr.reverse() : arr;
  }

  // ---------- Home ----------
  function chapterParts(ch) {
    const [name, sub] = ch.title.split(" — ");
    return { name, sub: (sub || "").replace(/[«»]/g, "") };
  }

  function renderHome() {
    el.chapterList.innerHTML = "";
    DATA.chapters.forEach((ch, ci) => {
      const { name, sub } = chapterParts(ch);
      const words = ch.scenes.reduce((n, s) => n + s.narration.join(" ").split(/\s+/).length, 0);
      const minutes = Math.max(1, Math.round(words / 110 + ch.scenes.length * 0.05));
      const b = document.createElement("button");
      b.innerHTML = `<b>${ci === 0 ? "★" : ci}</b><span>${escapeHtml(name)}${sub ? ` · ${escapeHtml(sub)}` : ""}<small>περίπου ${minutes} λεπτά · ${ch.scenes.length} σκηνές</small></span>`;
      b.onclick = () => openChapter(ci, 0, true);
      el.chapterList.append(b);
    });
    updateVoiceStatus();
  }

  function openChapter(ci, si, play) {
    state.chapter = DATA.chapters[ci];
    state.chapterIdx = ci;
    el.home.hidden = true;
    document.body.classList.remove("at-home");
    setPlaying(!!play);
    goto(si);
  }

  function goHome() {
    state.run++;
    stopEngine();
    setPlaying(false);
    el.quiz.hidden = true;
    el.titleCard.hidden = true;
    el.home.hidden = false;
    document.body.classList.add("at-home");
    history.replaceState(null, "", location.pathname);
    window.Background.set("night stars");
  }

  // ---------- Controls ----------
  $("#btn-prev").onclick = () => goto(Math.max(0, state.index - 1), { skipTitle: true });
  $("#btn-next").onclick = () => goto(state.index + 1, { skipTitle: true });
  el.play.onclick = togglePlay;
  $("#btn-home").onclick = goHome;
  el.cc.onclick = () => {
    const on = document.body.classList.toggle("no-cc");
    el.cc.classList.toggle("on", !on);
  };
  el.info.onclick = () => el.info.classList.toggle("on", document.body.classList.toggle("info"));
  $("#btn-full").onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };
  document.addEventListener("keydown", (e) => {
    if (!el.home.hidden) return;
    if (e.key === " ") { e.preventDefault(); togglePlay(); }
    else if (e.key === "ArrowRight") $("#btn-next").click();
    else if (e.key === "ArrowLeft") $("#btn-prev").click();
    else if (e.key.toLowerCase() === "c") el.cc.click();
    else if (e.key.toLowerCase() === "i") el.info.click();
    else if (e.key.toLowerCase() === "f") $("#btn-full").click();
    else if (e.key === "Escape") goHome();
  });

  // Fade the controls while the story plays and the mouse is still.
  let idleTimer = 0;
  const wake = () => {
    document.body.classList.remove("idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (state.playing) document.body.classList.add("idle"); }, 3000);
  };
  ["mousemove", "touchstart", "keydown"].forEach((ev) => document.addEventListener(ev, wake, { passive: true }));

  // ---------- Start ----------
  renderHome();
  window.Background.set("night stars");
  // "#ch1-5" opens chapter 1 at scene 5 (paused), handy for picking up where she left off.
  function openFromHash() {
    const m = location.hash.match(/^#ch(\d+)-(\d+)$/);
    if (!m || !DATA.chapters[+m[1]]) return;
    if (state.chapter === DATA.chapters[+m[1]] && state.index === +m[2] && el.home.hidden) return;
    openChapter(+m[1], +m[2], false);
  }
  window.addEventListener("hashchange", openFromHash);
  openFromHash();
})();
