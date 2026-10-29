// Coded background animations. Used whenever a scene has no AI video clip (site/bg/<slug>.mp4).
// Each theme is a sky gradient plus a particle style, picked from keywords in the scene's prompt.
(function () {
  const canvas = document.getElementById("bg-canvas");
  const ctx = canvas.getContext("2d");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const THEMES = {
    night: { sky: ["#05061a", "#141a44", "#2a2552"], particle: "star", count: 160 },
    sand:  { sky: ["#1a0f05", "#4a2c0c", "#8a5a1c"], particle: "sand", count: 260 },
    smoke: { sky: ["#1b0f17", "#5a2a22", "#c0662f"], particle: "smoke", count: 26, sea: true },
    steam: { sky: ["#16222b", "#2f4652", "#5e7b84"], particle: "steam", count: 30, water: true },
    lamp:  { sky: ["#120805", "#3a1a0b", "#6e3514"], particle: "ember", count: 40, glow: true },
    beams: { sky: ["#140f0a", "#3d2f20", "#7a6346"], particle: "mote", count: 90, beams: true },
    map:   { sky: ["#3b2a17", "#7a5d36", "#c9a66b"], particle: "ink", count: 40, parchment: true },
    dust:  { sky: ["#2a1c10", "#6d4a2a", "#c89a62"], particle: "dust", count: 120 },
    sea:   { sky: ["#0d2240", "#2f5f8a", "#e8b980"], particle: "glint", count: 60, sea: true },
    sunny: { sky: ["#123a6b", "#4f8fc4", "#f3d6a0"], particle: "cloud", count: 7, sun: true },
  };

  // First match wins, so the more specific moods come first.
  const KEYWORDS = [
    ["night", /night|stars|starry/i],
    ["sand", /sand|hourglass|tunnel/i],
    ["smoke", /smoke/i],
    ["steam", /steam/i],
    ["lamp", /lamp|candle/i],
    ["beams", /light beams|interior/i],
    ["map", /map|parchment|line drawing/i],
    ["dust", /dust|march|racetrack|road|street|countryside|grass|overcast/i],
    ["sea", /sea|harbor|harbour|port|waves|ship/i],
    ["sunny", /sun|morning|golden|clouds|sky|acropolis|rome|courtyard|classroom|building|colosseum/i],
  ];

  let theme = THEMES.night;
  let particles = [];
  let w = 0, h = 0, dpr = 1, t0 = performance.now();

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const rand = (a, b) => a + Math.random() * (b - a);

  function makeParticle(kind, fresh) {
    const p = { x: rand(0, w), y: rand(0, h), r: 1, a: rand(0.3, 1), s: rand(0.2, 1), ph: rand(0, Math.PI * 2) };
    switch (kind) {
      case "star": p.r = rand(0.4, 1.8); p.y = rand(0, h * 0.8); break;
      case "sand": p.ang = rand(0, Math.PI * 2); p.rad = rand(20, Math.hypot(w, h) / 1.6); p.r = rand(0.6, 2.4); break;
      case "smoke": p.r = rand(40, 120); p.y = fresh ? h + p.r : rand(h * 0.2, h); p.x = rand(w * 0.45, w * 0.95); p.a = rand(0.05, 0.16); break;
      case "steam": p.r = rand(50, 140); p.y = fresh ? h + p.r : rand(0, h); p.a = rand(0.04, 0.12); break;
      case "ember": p.r = rand(0.8, 2.2); p.y = fresh ? h + 5 : rand(0, h); break;
      case "mote": p.r = rand(0.6, 2); break;
      case "ink": p.r = rand(1, 3.5); p.a = rand(0.08, 0.25); break;
      case "dust": p.r = rand(0.8, 3); p.a = rand(0.15, 0.5); break;
      case "glint": p.y = rand(h * 0.68, h); p.r = rand(1, 2.5); break;
      case "cloud": p.r = rand(60, 140); p.y = rand(h * 0.05, h * 0.45); p.x = fresh ? -p.r * 3 : rand(-p.r, w); p.a = rand(0.35, 0.7); break;
    }
    return p;
  }

  function setTheme(prompt) {
    const match = KEYWORDS.find(([, re]) => re.test(prompt || ""));
    theme = THEMES[match ? match[0] : "night"];
    particles = Array.from({ length: theme.count }, () => makeParticle(theme.particle, false));
  }

  function drawSky(time) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, theme.sky[0]);
    g.addColorStop(0.6, theme.sky[1]);
    g.addColorStop(1, theme.sky[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    if (theme.sun) {
      const sg = ctx.createRadialGradient(w * 0.8, h * 0.22, 0, w * 0.8, h * 0.22, h * 0.45);
      sg.addColorStop(0, "rgba(255,240,200,0.9)");
      sg.addColorStop(0.15, "rgba(255,220,150,0.45)");
      sg.addColorStop(1, "rgba(255,220,150,0)");
      ctx.fillStyle = sg;
      ctx.fillRect(0, 0, w, h);
    }
    if (theme.glow) {
      const flick = 0.75 + Math.sin(time * 9) * 0.06 + Math.sin(time * 23) * 0.04;
      const lg = ctx.createRadialGradient(w * 0.5, h * 0.75, 0, w * 0.5, h * 0.75, h * 0.9 * flick);
      lg.addColorStop(0, "rgba(255,170,80,0.55)");
      lg.addColorStop(1, "rgba(255,120,40,0)");
      ctx.fillStyle = lg;
      ctx.fillRect(0, 0, w, h);
    }
    if (theme.beams) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 4; i++) {
        const x = w * (0.15 + i * 0.24) + Math.sin(time * 0.2 + i) * 20;
        const bg = ctx.createLinearGradient(x, 0, x - w * 0.18, h);
        bg.addColorStop(0, "rgba(255,225,160,0.16)");
        bg.addColorStop(1, "rgba(255,225,160,0)");
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.moveTo(x - 25, 0);
        ctx.lineTo(x + 25, 0);
        ctx.lineTo(x - w * 0.12, h);
        ctx.lineTo(x - w * 0.24, h);
        ctx.fill();
      }
      ctx.restore();
    }
    if (theme.parchment) {
      ctx.strokeStyle = "rgba(60,35,10,0.18)";
      ctx.lineWidth = 1;
      for (let i = 1; i < 8; i++) {
        ctx.beginPath();
        ctx.moveTo(0, (h / 8) * i);
        ctx.lineTo(w, (h / 8) * i);
        ctx.moveTo((w / 8) * i, 0);
        ctx.lineTo((w / 8) * i, h);
        ctx.stroke();
      }
    }
    if (theme.sea || theme.water) {
      const base = theme.water ? h * 0.72 : h * 0.68;
      for (let layer = 0; layer < 4; layer++) {
        const y0 = base + layer * h * 0.07;
        ctx.fillStyle = `rgba(${10 + layer * 8},${40 + layer * 14},${70 + layer * 16},${0.55 + layer * 0.12})`;
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w + 12; x += 12) {
          ctx.lineTo(x, y0 + Math.sin(x * 0.012 + time * (0.6 + layer * 0.25) + layer) * (6 + layer * 3));
        }
        ctx.lineTo(w, h);
        ctx.fill();
      }
    }
  }

  function drawParticles(time, dt) {
    const kind = theme.particle;
    const cx = w / 2, cy = h / 2;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      switch (kind) {
        case "star": {
          const a = p.a * (0.55 + 0.45 * Math.sin(time * (1 + p.s * 2) + p.ph));
          ctx.fillStyle = `rgba(255,250,235,${a})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
          break;
        }
        case "sand": {
          p.ang += dt * (0.25 + 40 / p.rad);
          p.rad -= dt * (18 + p.s * 30);
          if (p.rad < 8) Object.assign(p, makeParticle("sand", true), { rad: Math.hypot(w, h) / 1.6 });
          const x = cx + Math.cos(p.ang) * p.rad, y = cy + Math.sin(p.ang) * p.rad * 0.7;
          ctx.fillStyle = `rgba(255,${190 + p.s * 50},110,${p.a * 0.8})`;
          ctx.beginPath(); ctx.arc(x, y, p.r, 0, 7); ctx.fill();
          break;
        }
        case "smoke":
        case "steam": {
          p.y -= dt * (12 + p.s * 18);
          p.x += Math.sin(time * 0.3 + p.ph) * dt * 8;
          if (p.y < -p.r) particles[i] = makeParticle(kind, true);
          const c = kind === "smoke" ? "60,50,55" : "235,240,245";
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
          g.addColorStop(0, `rgba(${c},${p.a})`);
          g.addColorStop(1, `rgba(${c},0)`);
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
          break;
        }
        case "ember": {
          p.y -= dt * (20 + p.s * 30);
          p.x += Math.sin(time * 2 + p.ph) * dt * 10;
          if (p.y < h * 0.2) particles[i] = makeParticle("ember", true);
          ctx.fillStyle = `rgba(255,${150 + p.s * 80},60,${p.a * 0.8})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
          break;
        }
        case "mote":
        case "dust":
        case "ink": {
          const speed = kind === "dust" ? 22 : 6;
          p.x += dt * speed * p.s;
          p.y += Math.sin(time * 0.5 + p.ph) * dt * 4;
          if (p.x > w + 5) { p.x = -5; p.y = rand(0, h); }
          ctx.fillStyle = kind === "ink" ? `rgba(50,30,10,${p.a})` : `rgba(255,235,200,${p.a * 0.7})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
          break;
        }
        case "glint": {
          const a = Math.max(0, Math.sin(time * (1.5 + p.s) + p.ph));
          ctx.fillStyle = `rgba(255,245,215,${a * 0.8})`;
          ctx.fillRect(p.x, p.y, p.r * 3, p.r * 0.6);
          break;
        }
        case "cloud": {
          p.x += dt * (6 + p.s * 8);
          if (p.x - p.r * 2 > w) particles[i] = makeParticle("cloud", true);
          ctx.fillStyle = `rgba(255,255,255,${p.a * 0.5})`;
          for (let k = 0; k < 4; k++) {
            ctx.beginPath();
            ctx.ellipse(p.x + k * p.r * 0.55, p.y + Math.sin(k * 2) * p.r * 0.12, p.r * 0.6, p.r * 0.32, 0, 0, 7);
            ctx.fill();
          }
          break;
        }
      }
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const time = (now - t0) / 1000;
    drawSky(time);
    drawParticles(time, reduceMotion ? 0 : dt);
    requestAnimationFrame(frame);
  }

  window.addEventListener("resize", () => { resize(); setTheme(currentPrompt); });
  let currentPrompt = "";
  resize();
  setTheme("");
  requestAnimationFrame(frame);

  window.Background = {
    set(prompt) {
      currentPrompt = prompt;
      setTheme(prompt);
    },
  };
})();
