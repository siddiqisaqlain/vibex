// The header logo is a rack. V I B E X hang from a rail like clothes on hangers: run a finger or the
// mouse along them and they swing and knock into each other, scrolling sways them, and the X, three
// quick taps in, loops right over the rail. Plain text if this script doesn't run or for reduced motion.
(() => {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const logo = document.querySelector(".top .logo");
  if (!logo) return;

  // Split the mark into letters; the link's aria-label keeps its name for screen readers.
  const x = logo.querySelector("span");
  logo.textContent = "";
  const hang = (ch, cls) => { const e = document.createElement("b"); e.className = cls; e.textContent = ch; e.setAttribute("aria-hidden", "true"); logo.append(e); return e; };
  const els = [..."VIBE"].map((c) => hang(c, "lg"));
  if (x) els.push(hang(x.textContent, "lg lg-x"));
  logo.classList.add("rack-logo");

  // Pendulums. The X is the heavy garment: it swings slower.
  const S = els.map((el, i) => ({ el, a: 0, v: 0, k: i === 4 ? 52 : 74 }));
  const DAMP = 1.5, GAP = .13, BOUNCE = .82, MAX_V = 7;
  const clampV = (v) => Math.max(-MAX_V, Math.min(MAX_V, v));
  let raf = 0, last = 0, looping = false, touched = 0, audio = null, ticked = 0, restAt = 0;

  // A soft wooden tick when hangers knock. Only ever after the visitor has tapped the logo themselves.
  const tick = (force) => {
    if (!audio || performance.now() - touched > 1600 || performance.now() - ticked < 60) return;
    ticked = performance.now();
    const t = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
    o.type = "triangle"; o.frequency.setValueAtTime(1500 + Math.random() * 500, t); o.frequency.exponentialRampToValueAtTime(500, t + .05);
    g.gain.setValueAtTime(Math.min(.05, .012 * force), t); g.gain.exponentialRampToValueAtTime(.0001, t + .07);
    o.connect(g).connect(audio.destination); o.start(t); o.stop(t + .08);
  };

  const step = (dt) => {
    for (const s of S) { s.v += (-s.k * Math.sin(s.a) - DAMP * s.v) * dt; s.a += s.v * dt; }
    if (looping) return;
    // Bottoms touch once the left letter has swung far enough toward the right one (and vice versa).
    for (let i = 0; i < S.length - 1; i++) {
      const l = S[i], r = S[i + 1], over = r.a - l.a;
      if (over > GAP && r.v > l.v) {
        const hit = Math.abs(l.v - r.v);
        [l.v, r.v] = [r.v * BOUNCE, l.v * BOUNCE];
        const fix = (over - GAP) / 2;
        l.a += fix; r.a -= fix;
        if (hit > 1.2) tick(hit);
      }
    }
  };

  const frame = (now) => {
    const dt = Math.min(.033, (now - last) / 1000 || .016); last = now;
    for (let i = 0; i < 4; i++) step(dt / 4);
    const moving = S.some((s) => Math.abs(s.v) > .02 || Math.abs(Math.sin(s.a)) > .004);
    for (const s of S) s.el.style.transform = `rotate(${s.a.toFixed(4)}rad)`;
    if (moving) { raf = requestAnimationFrame(frame); return; }
    raf = 0; looping = false;
    for (const s of S) { s.a = 0; s.v = 0; s.el.style.transform = ""; }
    restAt = setTimeout(() => logo.classList.remove("swaying"), 350);
  };
  const wake = () => {
    clearTimeout(restAt);
    logo.classList.add("swaying");
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  };
  // Positive velocity turns clockwise, which carries the bottom of a letter left.
  const push = (i, v) => { if (!looping) { S[i].v = clampV(S[i].v + v); wake(); } };

  const letterAt = (cx) => {
    let at = -1, best = Infinity;
    S.forEach((s, i) => { const r = s.el.getBoundingClientRect(), d = Math.abs(cx - (r.left + r.right) / 2); if (d < best) { best = d; at = i; } });
    return at;
  };

  // Running along the rack, by mouse or by a finger sliding sideways.
  let prevX = null, prevT = 0, prevI = -1;
  logo.addEventListener("pointermove", (e) => {
    const now = performance.now();
    if (prevX !== null && now - prevT < 120) {
      const speed = (e.clientX - prevX) / Math.max(4, now - prevT);    // px per ms
      const i = letterAt(e.clientX);
      if (i !== prevI) { push(i, -Math.max(-3, Math.min(3, speed * 3.4))); prevI = i; }
    }
    prevX = e.clientX; prevT = now;
  });
  logo.addEventListener("pointerleave", () => { prevX = null; prevI = -1; });

  // A tap swings what it hits, away from the side it was hit on. Three quick taps on the X send it over the rail.
  let taps = 0, tapAt = 0, moved = false, downX = 0;
  logo.addEventListener("pointerdown", (e) => {
    downX = e.clientX; moved = false; touched = performance.now();
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch {}
    const i = letterAt(e.clientX), r = S[i].el.getBoundingClientRect();
    push(i, e.clientX < (r.left + r.right) / 2 ? -2.8 : 2.8);
    if (navigator.vibrate) navigator.vibrate(6);
    if (i !== 4) { taps = 0; return; }
    taps = touched - tapAt < 600 ? taps + 1 : 1; tapAt = touched;
    if (taps >= 3) {
      taps = 0; looping = true;
      S[4].v = -19; S[3].v = clampV(S[3].v + 4);
      wake();
    }
  });
  logo.addEventListener("pointerup", (e) => { moved = Math.abs(e.clientX - downX) > 8; });

  // On the home page a tap goes to Featured instead of reloading (a reload would replay the intro),
  // and a finger run along the rack only plays it. On other pages it's the link to home's Featured.
  logo.addEventListener("click", (e) => {
    if (location.pathname !== "/") { if (moved) e.preventDefault(); return; }
    e.preventDefault();
    if (moved) return;
    const feat = document.getElementById("feat");
    if (feat && !feat.hidden) feat.scrollIntoView({ behavior: "smooth" });
    else if (scrollY > 40) scrollTo({ top: 0, behavior: "smooth" });
  });

  // Scrolling sways the whole rack, like the rail itself got nudged.
  let lastY = scrollY;
  addEventListener("scroll", () => {
    const d = scrollY - lastY; lastY = scrollY;
    if (Math.abs(d) < 2 || looping) return;
    const v = Math.max(-1.1, Math.min(1.1, d * .045));
    S.forEach((s) => { s.v = clampV(s.v + v); });
    wake();
  }, { passive: true });

  // Hello: once the logo has landed in the header, a hand runs along the rack, so people find it.
  const hello = () => S.forEach((s, i) => setTimeout(() => push(i, -2), i * 75));
  const root = document.documentElement;
  if (!root.classList.contains("vx-pre")) setTimeout(hello, 700);
  else {
    const seen = new MutationObserver(() => {
      if (root.classList.contains("vx-pre")) return;
      seen.disconnect(); setTimeout(hello, 950);
    });
    seen.observe(root, { attributes: true, attributeFilter: ["class"] });
  }
})();
