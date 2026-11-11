// Opening, in 3D: India as a model on a table. It opens in plan, the camera sweeps down and slowly
// orbits (after the "An Ode to the Dead" landing), parcels arc out of Srinagar and land across the
// country, each city raising a pin. Then the camera dives into the map, the VIBE X mark flies up into the header, and the rest of the page arrives in step.
// Once per visit (tab); ?intro replays it. Tap or Skip to go straight to the hand-off.
// Without the intro (repeat visits) the page still makes the same entrance.
// Map: India's official boundary (@svg-maps/india, simplified), Mercator.
(() => {
  const root = document.documentElement;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return; // no map for these visitors
  // The page waits, hidden, for its entrance (shop.css: .vx-pre / .vx-enter). Safety net: never stay hidden.
  root.classList.add("vx-pre");
  const enter = () => {
    if (root.classList.contains("vx-enter")) return;
    root.classList.add("vx-enter"); root.classList.remove("vx-pre");
    setTimeout(() => root.classList.remove("vx-enter"), 1700);
  };
  const safety = setTimeout(() => { if (!document.querySelector(".vxi")) enter(); }, 9000);

  const force = /[?&]intro\b/.test(location.search);
  let seen = false;
  try { seen = sessionStorage.getItem("vx-intro") === "1"; sessionStorage.setItem("vx-intro", "1"); } catch { /* private mode */ }
  if ((!force && seen) || !document.createElement("canvas").getContext) {
    // no intro: just the entrance, once the first paint is ready
    // wait (up to 2.5 s) for the category buttons to be drawn, so there is something to arrive
    const t = performance.now();
    const wait = () => {
      if (document.querySelector(".cat-tab") || performance.now() - t > 2500) { clearTimeout(safety); requestAnimationFrame(enter); }
      else requestAnimationFrame(wait);
    };
    requestAnimationFrame(wait);
    return;
  }

  const STATES = window.VXIndia || [];
  const SRINAGAR = [139.8, 77.3];
  // name, x, y (map units), tag: name tag to the Left / Centre / Right of the pin's stem
  const CITIES = [
    ["Delhi", 190.1, 211.6, "C"], ["Ahmedabad", 93.2, 341.8, "L"],
    ["Lucknow", 268.2, 253.3], ["Mumbai", 99.7, 430.3, "L"], ["Kolkata", 423.0, 352.0, "R"],
    ["Hyderabad", 216.8, 467.6, "C"], ["Guwahati", 493.7, 269.9, "C"], 
    ["Bengaluru", 198.0, 563.5, "L"], ["Chennai", 254.0, 561.2, "R"], ["Bhubaneswar", 370.0, 403.1],
    ["Kochi", 170.5, 628.6], ["Leh", 197.8, 75.5],
  ];
  const LAKSHADWEEP = [[94.6, 614.9], [85, 601.1], [103, 663.6], [96.5, 625.8]];
  const RED = "#e2382c", INK = "#121212";

  // ---- timeline (ms) ----
  const SWEEP_AT = 300, SWEEP = 2400;
  const LAUNCH_AT = 600, STEP = 120, FLY = 1150;
  const LANDED = LAUNCH_AT + (CITIES.length - 1) * STEP + FLY;            // last parcel down
  const HOLD_TO = LANDED + 700;                                          // a beat to read the count (~2.8 s)
  const EXIT = 820; // the dive / hand-off

  // ---- geometry, centred on the middle of the mainland ----
  const CX = 300, CY = 350;
  const polys = [];
  for (const d of STATES) for (const ring of d.split("Z")) {
    if (!ring) continue;
    polys.push(ring.slice(1).split("L").map((p) => { const [x, y] = p.split(" ").map(Number); return [x - CX, y - CY]; }));
  }
  // points that decide the framing: the mainland and the north-east (islands sit outside the frame's maths)
  const frame = [];
  for (const p of polys) p.forEach(([x, y], i) => { if (i % 3 === 0 && !(x + CX > 500 && y + CY > 540)) frame.push([x, y]); });
  const routes = CITIES.map(([name, x, y, tag], i) => {
    const sx = SRINAGAR[0] - CX, sy = SRINAGAR[1] - CY, ex = x - CX, ey = y - CY;
    const len = Math.hypot(ex - sx, ey - sy);
    const bend = Math.min(60, len * .16) * (x < SRINAGAR[0] + 40 ? -1 : 1);
    const mx = (sx + ex) / 2 + (-(ey - sy) / len) * bend, my = (sy + ey) / 2 + ((ex - sx) / len) * bend;
    const H = 24 + len * .26;
    const pts = [];
    for (let k = 0; k <= 48; k++) {
      const t = k / 48, u = 1 - t;
      pts.push([u * u * sx + 2 * u * t * mx + t * t * ex, u * u * sy + 2 * u * t * my + t * t * ey, H * 4 * t * u]);
    }
    return { name, x: ex, y: ey, tag, pts, at: LAUNCH_AT + i * STEP };
  });

  // ---- furniture ----
  const css = `
  body.vxi-on { overflow: hidden; }
  .vxi { position: fixed; inset: 0; z-index: 1000; cursor: pointer; }
  .vxi-bg { position: absolute; inset: 0; background: radial-gradient(110% 80% at 50% 42%, #f9f8f5 0%, #f2f0eb 62%, #e9e6e0 100%); transition: opacity .55s ease; }
  .vxi canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  .vxi-copy { position: absolute; left: 0; right: 0; bottom: calc(8vh + env(safe-area-inset-bottom)); display: flex; flex-direction: column; align-items: center; pointer-events: none; }
  .vxi-logo { font: 800 36px/1 'Schibsted Grotesk', Arial, sans-serif; color: ${INK}; letter-spacing: -.045em; white-space: nowrap; transform-origin: 0 0; opacity: 0; transform: translateY(14px); animation: vxiUp .8s cubic-bezier(.2,.8,.2,1) .6s forwards; }
  .vxi-logo span { color: ${RED}; margin-left: 2px; }
  .vxi-copy p { margin: 12px 0 0; font: 500 11.5px/1.4 'Geist Mono', ui-monospace, monospace; text-transform: uppercase; letter-spacing: .1em; color: #85837d; opacity: 0; transform: translateY(10px); animation: vxiUp .8s cubic-bezier(.2,.8,.2,1) .8s forwards; transition: opacity .25s; }
  .vxi-copy p b { color: ${RED}; font-weight: 700; }
  @keyframes vxiUp { to { opacity: 1; transform: none; } }
  .vxi-skip, .vxi-compass { transition: opacity .3s; }
  .vxi-skip { position: absolute; right: 16px; top: calc(16px + env(safe-area-inset-top)); padding: 8px 14px; border: 1px solid rgba(18,18,18,.18); border-radius: 999px; background: rgba(249,248,245,.8); backdrop-filter: blur(6px); font: 500 11px 'Geist Mono', ui-monospace, monospace; letter-spacing: .08em; text-transform: uppercase; color: #3d3c39; cursor: pointer; }
  .vxi-compass { position: absolute; left: 18px; top: calc(18px + env(safe-area-inset-top)); width: 34px; height: 34px; border-radius: 50%; border: 1px solid rgba(18,18,18,.18); background: rgba(249,248,245,.8); font: 600 9px 'Geist Mono', monospace; color: ${INK}; }
  .vxi-compass-in { position: relative; width: 100%; height: 100%; display: grid; place-items: center; }
  .vxi-compass i { position: absolute; top: 4px; width: 0; height: 0; border: 4px solid transparent; border-bottom: 9px solid ${RED}; border-top: 0; }
  .vxi.leaving { pointer-events: none; }
  .vxi.leaving .vxi-skip, .vxi.leaving .vxi-compass, .vxi.leaving .vxi-copy p, .vxi.leaving .vxi-count { opacity: 0; }
  /* delivery pill: slides up under the counter while the parcels are in the air */
  .vxi-ship { display: inline-flex; align-items: center; gap: 9px; margin-top: 14px; padding: 8px 14px 8px 11px; border-radius: 999px; background: ${INK}; color: #fff; font: 500 11px 'Geist Mono', ui-monospace, monospace; letter-spacing: .06em; text-transform: uppercase; white-space: nowrap; opacity: 0; transform: translateY(12px); transition: opacity .25s; }
  .vxi-ship.on { animation: vxiUp .7s cubic-bezier(.2,.8,.2,1) forwards; }
  .vxi-ship svg { width: 18px; height: 18px; fill: none; stroke: #fff; stroke-width: 1.6; stroke-linejoin: round; }
  .vxi-ship b { font-weight: 700; color: ${RED}; filter: brightness(1.35); }
  .vxi-ship span { opacity: .85; }
  @keyframes vxiDrive { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(3px); } }
  .vxi.leaving .vxi-ship { opacity: 0; }
  /* after the deliveries: the intro waits for the customer (tap / click / scroll / Enter) */
  .vxi-go { display: inline-flex; align-items: center; gap: 10px; margin-top: 18px; padding: 10px 18px; border: 1px solid rgba(18,18,18,.22); border-radius: 999px; background: rgba(255,255,255,.7); backdrop-filter: blur(6px); font: 500 12.5px 'Geist Mono', ui-monospace, monospace; letter-spacing: .02em; color: ${INK}; opacity: 0; transform: translateY(10px); pointer-events: none; transition: opacity .3s; }
  .vxi-go.on { animation: vxiUp .8s cubic-bezier(.2,.8,.2,1) forwards; }
  .vxi-go i { width: 7px; height: 7px; border-radius: 50%; background: ${RED}; animation: vxiBeat 2.8s ease-out infinite; }
  .vxi-go svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  @keyframes vxiNudge { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
  @keyframes vxiBeat { 0% { box-shadow: 0 0 0 0 rgba(226,56,44,.5); } 80%, 100% { box-shadow: 0 0 0 9px rgba(226,56,44,0); } }
  .vxi.ready .vxi-skip { opacity: 0; pointer-events: none; }
  .vxi.leaving .vxi-go { opacity: 0; }
  @media (max-width: 600px) { .vxi-go { font-size: 12px; padding: 9px 16px; margin-top: 14px; } }
  @media (max-width: 600px) { .vxi-ship { font-size: 10px; padding: 7px 12px 7px 10px; } }
  /* orders counter: ticks up as parcels land, then flips to the headline figure with a flash */
  .vxi-count { position: relative; margin-top: 12px; font: 700 50px/1 'Schibsted Grotesk', Arial, sans-serif; letter-spacing: -.05em; color: ${INK}; font-variant-numeric: tabular-nums; white-space: nowrap; transition: opacity .25s; }
  .vxi-count b { display: inline-block; font: inherit; }
  .vxi-count.done b { color: ${RED}; animation: vxiPop .6s cubic-bezier(.2,1.2,.4,1); }
  @keyframes vxiPop { 0% { transform: scale(.94); } 100% { transform: scale(1); } }
  @keyframes vxiShine { from { background-position: 100% 0; } to { background-position: 0 0; } }
  @keyframes vxiBurst { 0% { opacity: 1; transform: translate(-50%, -50%) scale(.6); } 100% { opacity: 0; transform: translate(-50%, -50%) scale(1.5); } }
  @media (max-width: 600px) { .vxi-count { font-size: 40px; } }
  @media (max-width: 600px) { .vxi-logo { font-size: 30px; } .vxi-copy p { font-size: 10.5px; letter-spacing: .08em; } }`;

  const el = document.createElement("div");
  el.className = "vxi";
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", "Vibe X ships from Srinagar to cities across India");
  el.innerHTML = `<style>${css}</style><div class="vxi-bg"></div><canvas></canvas>
    <div class="vxi-compass" aria-hidden="true"><div class="vxi-compass-in"><i></i><span>N</span></div></div>
    <div class="vxi-copy"><div class="vxi-logo">VIBE<span>X</span></div><div class="vxi-count" hidden><b>0</b></div><p>From Srinagar to <b>all of India</b></p><div class="vxi-ship" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 6.5h11v9h-11zM13.5 9.5h4l3 3.2v2.8h-7z"/><circle cx="6.5" cy="17" r="1.7"/><circle cx="17" cy="17" r="1.7"/></svg><b></b><span></span></div><div class="vxi-go" role="button" aria-label="Continue to the shop"><i></i><span>Tap to Continue</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></div></div>
    <button class="vxi-skip" type="button">Skip</button>`;
  document.body.prepend(el);
  document.body.classList.add("vxi-on");
  const canvas = el.querySelector("canvas"), ctx = canvas.getContext("2d");
  const needle = el.querySelector(".vxi-compass-in"), logo = el.querySelector(".vxi-logo"), copy = el.querySelector(".vxi-copy");
  const copyP = copy.querySelector("p");
  logo.style.animationPlayState = copyP.style.animationPlayState = "paused";   // they start with the clock

  // Orders fulfilled (shop.json -> claims.orders). config.js loads after this script, so it is read
  // when the clock starts. It counts up with the parcels and lands on the headline figure.
  const countEl = el.querySelector(".vxi-count"), countB = countEl.querySelector("b");
  let orders = null, shown = -1;
  function setupCount() {
    const o = window.SHOP && window.SHOP.claims && window.SHOP.claims.orders;
    if (!o || !o.count) return;
    orders = o;
    countEl.hidden = false;
    copyP.innerHTML = `${(o.small || "orders fulfilled").replace(/[<>&]/g, "")} · from Srinagar to <b>all of India</b>`;
  }
  // Delivery line (shop.json -> claims.delivery), shown once the parcels are in the air.
  const ship = el.querySelector(".vxi-ship");
  function setupShip() {
    const dl = window.SHOP && window.SHOP.claims && window.SHOP.claims.delivery;
    if (!dl || !dl.label) return false;
    ship.querySelector("b").textContent = dl.label;
    ship.querySelector("span").textContent = dl.detail ? `· ${dl.detail}` : "";
    ship.hidden = false;
    setTimeout(() => ship.classList.add("on"), LAUNCH_AT + 450);
    return true;
  }
  let shipping = false;
  function tickCount(ms) {
    if (countEl.classList.contains("done")) return;
    const p = clamp01((ms - LAUNCH_AT) / (LANDED - LAUNCH_AT));
    const n = Math.round(orders.count * (1 - Math.pow(1 - p, 2.2)) / 100) * 100;
    if (p >= 1) { countB.textContent = String(orders.label || orders.count).toUpperCase(); countEl.classList.add("done"); return; }
    if (n !== shown) { shown = n; countB.textContent = n.toLocaleString("en-IN"); }
  }

  let W = 0, H = 0, dpr = 1;
  function resize() { dpr = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight; canvas.width = W * dpr; canvas.height = H * dpr; }
  resize();
  addEventListener("resize", resize);

  const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeIn = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * t);
  const clamp01 = (t) => Math.max(0, Math.min(1, t));

  // ---- camera: angles from the timeline, scale and centre fitted to the real projected outline ----
  const cam = { pitch: 0, bearing: 0, k: 1, cx: 0, cy: 0, D: 1700 };
  function raw(x, y, z) {
    const cb = Math.cos(cam.bearing), sb = Math.sin(cam.bearing), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const x1 = x * cb - y * sb, y1 = x * sb + y * cb;
    const f = cam.D / Math.max(80, cam.D - y1 * sp - z * cp);
    return [x1 * f, (y1 * cp - z * sp) * f, f];
  }
  function P(x, y, z = 0) { const [a, b, f] = raw(x, y, z); return [cam.cx + a * cam.k, cam.cy + b * cam.k, f]; }
  let exitAt = 0;
  function camera(ms, now) {
    const s = ease(clamp01((ms - SWEEP_AT) / SWEEP));
    const drift = Math.max(0, ms - SWEEP_AT - SWEEP * .6) * .5;
    const e = exitAt ? clamp01((now - exitAt) / EXIT) : 0;
    cam.pitch = s * .8 * (1 - .35 * ease(e));
    cam.bearing = -0.02 - s * .14 - drift * .0000016;
    // fit: measure the outline as it projects now, then scale and centre it into the frame box
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const [x, y] of frame) { const [a, b] = raw(x, y, 0); if (a < x0) x0 = a; if (a > x1) x1 = a; if (b < y0) y0 = b; if (b > y1) y1 = b; }
    y0 -= 40 * s;                                                  // headroom for arcs and the Srinagar tag
    const mobile = W < 700;
    const box = { l: mobile ? 26 : 70, r: mobile ? 26 : 70, t: mobile ? 92 : 70, b: (mobile ? 150 : 170) + (orders ? (mobile ? 50 : 60) : 0) + (shipping ? 46 : 0) + 50 };
    const bw = W - box.l - box.r, bh = H - box.t - box.b;
    const fit = Math.min(bw / (x1 - x0), bh / (y1 - y0));
    // the dive: zoom hard into Srinagar until the white top of the model fills the screen
    const z = 1 + ease(e) * 9;
    cam.k = fit * z;
    const [hxr, hyr] = raw(SRINAGAR[0] - CX, SRINAGAR[1] - CY, 0);
    const cx0 = box.l + bw / 2 - ((x0 + x1) / 2) * fit, cy0 = box.t + bh / 2 - ((y0 + y1) / 2) * fit;
    const hx0 = cx0 + hxr * fit, hy0 = cy0 + hyr * fit;               // Srinagar on screen before the dive
    const m = ease(clamp01(e * 1.4));                                  // ...drifts to the centre as we fall
    const ax = hx0 + (W / 2 - hx0) * m, ay = hy0 + (H * .5 - hy0) * m;
    cam.cx = ax - hxr * cam.k; cam.cy = ay - hyr * cam.k;
    return e;
  }

  function path(pts, z, dx = 0, dy = 0) {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) { const [sx, sy] = P(pts[i][0] + dx, pts[i][1] + dy, z); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); }
    ctx.closePath();
  }
  function ring(x, y, r) {
    ctx.beginPath();
    for (let a = 0; a <= 28; a++) { const t = (a / 28) * Math.PI * 2; const [sx, sy] = P(x + Math.cos(t) * r, y + Math.sin(t) * r, 0); a ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); }
    ctx.closePath();
  }
  function tag(x, y, text, h, dark, alpha, side = "C") {
    if (alpha <= 0) return;
    const [gx, gy] = P(x, y, 0), [tx, ty] = P(x, y, h);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = dark ? INK : "rgba(26,26,26,.5)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.font = `500 ${dark ? 11.5 : 10}px "Geist Mono", ui-monospace, monospace`;
    const label = text.toUpperCase(), w = ctx.measureText(label).width + 16, hh = dark ? 23 : 19;
    const bx = side === "L" ? tx - w + 8 : side === "R" ? tx - 8 : tx - w / 2, by = ty - hh;
    ctx.fillStyle = dark ? INK : "rgba(251,250,248,.97)";
    ctx.shadowColor = "rgba(0,0,0,.08)"; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, w, hh, hh / 2) : ctx.rect(bx, by, w, hh); ctx.fill();
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.fillStyle = dark ? "#fff" : INK; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, bx + w / 2, by + hh / 2 + .5);
    ctx.globalAlpha = 1;
  }
  const strokeLine = (pts, z0) => { ctx.beginPath(); pts.forEach(([x, y, z], i) => { const [sx, sy] = P(x, y, z0 === undefined ? z : z0); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); }); ctx.stroke(); };

  // The camera holds still until the shop underneath has been built: building it stalls the page for
  // a moment, and a stall during a still frame can not be seen. Then the clock starts.
  const tLoad = performance.now();
  let t0 = 0;
  const built = () => document.querySelector("#grid .card");
  let raf = 0, over = false;
  function draw(now) {
    if (!t0 && (built() || now - tLoad > 1600)) { t0 = now; root.dataset.vxiStart = Math.round(now); logo.style.animationPlayState = copyP.style.animationPlayState = "running"; setupCount(); shipping = setupShip(); }
    if (orders) tickCount(t0 ? now - t0 : 0);
    const ms = t0 ? now - t0 : 0;
    if (t0 && !ready && ms >= LANDED) { ready = true; el.classList.add("ready"); setTimeout(() => go.classList.add("on"), 150); }
    const e = camera(ms, now);
    const fade = 1 - clamp01(e * 2.4);                          // routes, pins, floor clear early in the dive
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const slab = ease(clamp01(ms / 450));                    // fades in with the clock, after any start-up stall
    const appear = slab * fade;
    const T = 10;

    // floor: a faint dot grid the model sits on
    const diving = e > .12;
    if (!diving) {
    ctx.fillStyle = "#c3beb4";
    for (let gx = -560; gx <= 560; gx += 40) for (let gy = -520; gy <= 560; gy += 40) {
      const d = Math.hypot(gx * .9, gy) / 600;
      if (d > 1) continue;
      const [sx, sy, f] = P(gx, gy, -T * 3);
      ctx.globalAlpha = appear * .35 * (1 - d) * (1 - d);
      ctx.fillRect(sx - .8 * f, sy - .8 * f, 1.6 * f, 1.6 * f);
    }
    }
    ctx.globalAlpha = slab;

    // shadow, then the slab's side in three bands, then the top: outline first, fill over it, state lines last
    if (!diving) {
      ctx.fillStyle = "rgba(0,0,0,.03)";
      for (const off of [22, 14, 8]) for (const p of polys) { path(p, -T * 3, off * .4, off); ctx.fill(); }
      for (const [z, c] of [[-T, "#c7c2b9"], [-T * .66, "#d3cfc7"], [-T * .33, "#dfdbd4"]]) {
        ctx.fillStyle = c; for (const p of polys) { path(p, z); ctx.fill(); }
      }
    }
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#a59f94"; ctx.lineWidth = 2.2;
    for (const p of polys) { path(p, 0); ctx.stroke(); }
    const [, gTop] = P(0, -300, 0), [, gBot] = P(0, 320, 0);
    const top = ctx.createLinearGradient(0, gTop, 0, gBot);
    top.addColorStop(0, "#faf9f6"); top.addColorStop(1, "#f1efea");
    ctx.fillStyle = top;
    for (const p of polys) { path(p, 0); ctx.fill(); }
    ctx.strokeStyle = "#e2ded7"; ctx.lineWidth = .7;
    for (const p of polys) { path(p, 0); ctx.stroke(); }
    ctx.globalAlpha = appear;
    ctx.fillStyle = "#bdb8ae";
    for (const [x, y] of LAKSHADWEEP) { const [sx, sy] = P(x - CX, y - CY, 0); ctx.beginPath(); ctx.arc(sx, sy, 1.5, 0, 7); ctx.fill(); }

    // Srinagar: a beam of light and rings breathing outward
    const hx = SRINAGAR[0] - CX, hy = SRINAGAR[1] - CY;
    const [bx0, by0] = P(hx, hy, 0), [bx1, by1] = P(hx, hy, 110 * ease(clamp01((ms - 100) / 700)));
    const beam = ctx.createLinearGradient(bx0, by0, bx1, by1);
    beam.addColorStop(0, "rgba(226,56,44,.28)"); beam.addColorStop(1, "rgba(226,56,44,0)");
    ctx.strokeStyle = beam; ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(bx0, by0); ctx.lineTo(bx1, by1); ctx.stroke();
    {
      const ph = (ms / 3400) % 1;                                    // one slow ring
      ring(hx, hy, 6 + ph * 26);
      ctx.strokeStyle = `rgba(226,56,44,${.32 * (1 - ph) * appear})`; ctx.lineWidth = 1; ctx.stroke();
    }

    // routes
    for (const r of routes) {
      const p = (ms - r.at) / FLY;
      if (p <= 0) continue;
      const q = ease(clamp01(p)), n = Math.max(1, Math.round(q * 48));
      const pts = r.pts.slice(0, n + 1);
      ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(0,0,0,.035)"; ctx.lineWidth = 1; strokeLine(pts, 0);           // shadow on the map
      ctx.strokeStyle = "rgba(226,56,44,.05)"; ctx.lineWidth = 4; strokeLine(pts);           // glow
      ctx.strokeStyle = "rgba(226,56,44,.5)"; ctx.lineWidth = 1.1; strokeLine(pts);          // the arc
      if (p < 1) {
        ctx.strokeStyle = "rgba(226,56,44,.7)"; ctx.lineWidth = 2; strokeLine(pts.slice(-6));  // comet
        const [sx, sy, f] = P(...pts[pts.length - 1]);
        ctx.fillStyle = "#fff"; ctx.shadowColor = "rgba(226,56,44,.6)"; ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.arc(sx, sy, 2.1 * f, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
      } else {
        const since = ms - r.at - FLY;
        const rip = clamp01(since / 1100);
        if (rip < 1) { ring(r.x, r.y, 4 + rip * 20); ctx.strokeStyle = `rgba(226,56,44,${.4 * (1 - rip) * appear})`; ctx.lineWidth = 1; ctx.stroke(); }
        ring(r.x, r.y, 3); ctx.fillStyle = RED; ctx.fill();
        const rise = ease(clamp01(since / 600));
        if (r.tag) tag(r.x, r.y, r.name, 28 * rise, false, rise * appear, r.tag);
        else {
          const [gx, gy] = P(r.x, r.y, 0), [tx, ty] = P(r.x, r.y, 10 * rise);
          ctx.strokeStyle = RED; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(tx, ty); ctx.stroke();
          ctx.beginPath(); ctx.arc(tx, ty, 2.1, 0, 7); ctx.fillStyle = RED; ctx.fill();
        }
      }
    }
    // while it waits: parcels keep leaving Srinagar, one route at a time
    if (ms > LANDED && !exitAt) {
      routes.forEach((r, i) => {
        const ph = (ms - LANDED - 400 - i * 1600) % (routes.length * 1600);
        if (ph < 0 || ph > FLY) return;
        const q = ease(ph / FLY), k = Math.round(q * 48);
        ctx.globalAlpha = appear;
        ctx.strokeStyle = "rgba(226,56,44,.6)"; ctx.lineWidth = 1.8; ctx.lineCap = "round"; strokeLine(r.pts.slice(Math.max(0, k - 6), k + 1));
        const [sx, sy, f] = P(...r.pts[k]);
        ctx.fillStyle = "#fff"; ctx.shadowColor = "rgba(226,56,44,.6)"; ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.arc(sx, sy, 2 * f, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
      });
    }
    const [hsx, hsy] = P(hx, hy, 0);
    ctx.globalAlpha = appear;
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(hsx, hsy, 4.8, 0, 7); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(hsx, hsy, 1.8, 0, 7); ctx.fill();
    const homeRise = ease(clamp01((ms - 120) / 550));
    tag(hx, hy, "Srinagar · Vibe X", 48 * homeRise, true, homeRise * appear * (1 - e));
    ctx.globalAlpha = 1;

    needle.style.transform = `rotate(${(cam.bearing * 180) / Math.PI}deg)`;
    if (!over) raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);

  // ---- the hand-off ----
  function leave(fast) {
    if (exitAt) return;
    exitAt = performance.now() - (fast ? EXIT * .15 : 0);
    unlisten();
    clearTimeout(timer);
    el.classList.add("leaving");
    clearTimeout(safety);
    // once the dive has whited the screen out, lift the layer: the page underneath is white too,
    // so the only things that move are the page's own arrivals (header, pills)
    const lift = Math.max(0, EXIT * .3 - (performance.now() - exitAt));
    setTimeout(() => {
      document.body.classList.remove("vxi-on");
      enter();
      el.style.transition = "opacity .5s cubic-bezier(.4,0,.2,1)";
      el.style.opacity = "0";
    }, lift);
    // the VIBE X mark flies into the header logo
    const target = document.querySelector(".top .logo");
    if (target) {
      const a = logo.getBoundingClientRect(), b = target.getBoundingClientRect();
      logo.style.animation = "none"; logo.style.opacity = "1";
      logo.style.transition = "transform .72s cubic-bezier(.65,0,.25,1)";
      logo.style.transform = `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(${b.width / a.width})`;
      target.style.opacity = "0";
      setTimeout(() => { target.style.transition = "none"; target.style.opacity = ""; logo.style.opacity = "0"; }, 730);
    }
    copy.style.transition = "none";
    setTimeout(() => { over = true; cancelAnimationFrame(raf); el.remove(); removeEventListener("resize", resize); }, EXIT + 120);
  }
  const go = el.querySelector(".vxi-go");
  let ready = false;
  const timer = 0;
  const enterNow = () => leave(!ready);                     // before the deliveries finish: the quick version
  el.addEventListener("click", enterNow);
  const onWheel = (e) => { if (e.deltaY > 6) enterNow(); };
  let touchY = null;
  const onTouchStart = (e) => { touchY = e.touches[0].clientY; };
  const onTouchMove = (e) => { if (touchY !== null && touchY - e.touches[0].clientY > 40) { touchY = null; enterNow(); } };
  const onKey = (e) => { if (["Enter", " ", "ArrowDown", "PageDown", "Escape"].includes(e.key)) { e.preventDefault(); enterNow(); } };
  addEventListener("wheel", onWheel, { passive: true });
  addEventListener("touchstart", onTouchStart, { passive: true });
  addEventListener("touchmove", onTouchMove, { passive: true });
  addEventListener("keydown", onKey);
  const unlisten = () => { removeEventListener("wheel", onWheel); removeEventListener("touchstart", onTouchStart); removeEventListener("touchmove", onTouchMove); removeEventListener("keydown", onKey); };
})();
