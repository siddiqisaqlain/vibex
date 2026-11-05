// The hero's right side: India, with parcels leaving Srinagar for one city after another.
// The cities show where we ship, not live orders: the only real-time things here are the clock and
// the posts under the map (renderHeroFeed in shop.js). Hover a city to send one there.
// Asleep while out of view or hidden (phones hide it altogether). Reduced motion: every route, still.
(() => {
  const box = document.getElementById("hl-map");
  const clock = document.getElementById("hl-clock");
  if (!box || !window.VXIndia) return;

  const fmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });
  const tick = () => { clock.textContent = `${fmt.format(new Date())} IST`; };
  tick();
  setInterval(tick, 20000);

  const SVG = "http://www.w3.org/2000/svg";
  const make = (tag, attrs, parent) => {
    const e = document.createElementNS(SVG, tag);
    Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    parent.append(e);
    return e;
  };
  const HOME = [139.8, 77.3];
  // name, x, y (map units, as intro.js), which side the name sits
  const CITIES = [
    ["Delhi", 190.1, 211.6, "end"], ["Mumbai", 99.7, 430.3, "end"], ["Kolkata", 423, 352, "start"],
    ["Bengaluru", 198, 563.5, "end"], ["Guwahati", 493.7, 269.9, "start"], ["Ahmedabad", 93.2, 341.8, "end"],
    ["Chennai", 254, 561.2, "start"], ["Hyderabad", 216.8, 467.6, "start"], ["Lucknow", 268.2, 253.3, "start"],
    ["Kochi", 170.5, 628.6, "end"], ["Bhubaneswar", 370, 403.1, "start"], ["Leh", 197.8, 75.5, "start"],
  ];

  const svg = make("svg", { viewBox: "0 0 612 696", preserveAspectRatio: "xMidYMid meet" }, box);
  window.VXIndia.forEach((d) => make("path", { d, class: "hl-state" }, svg));
  const arcs = make("g", {}, svg);
  const cities = CITIES.map(([name, x, y, side]) => {
    const g = make("g", { class: "hl-city" }, svg);
    make("circle", { cx: x, cy: y, r: 5 }, g);
    make("circle", { cx: x, cy: y, r: 22, class: "hit" }, g);
    make("text", { x: x + (side === "end" ? -13 : 13), y: y + 8, "text-anchor": side }, g).textContent = name;
    return { name, x, y, g };
  });
  make("circle", { cx: HOME[0], cy: HOME[1], r: 9, class: "hl-ring" }, svg);
  make("circle", { cx: HOME[0], cy: HOME[1], r: 8, class: "hl-home" }, svg);

  // A bowed line from Srinagar, leaning east so routes fan out instead of stacking.
  const route = (c) => {
    const mx = (HOME[0] + c.x) / 2, my = (HOME[1] + c.y) / 2;
    const bow = Math.hypot(c.x - HOME[0], c.y - HOME[1]) * .22;
    return `M${HOME[0]} ${HOME[1]}Q${mx + bow} ${my - bow * .35} ${c.x} ${c.y}`;
  };

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    cities.forEach((c) => { make("path", { d: route(c), class: "hl-arc done" }, arcs); });
    return;
  }

  const FLY = 1700, GAP = 1300, MAX_ARCS = 5;
  const flights = [];
  const trail = [];
  function send(c) {
    if (flights.some((f) => f.c === c)) return;
    const path = make("path", { d: route(c), class: "hl-arc" }, arcs);
    const len = path.getTotalLength();
    path.style.strokeDasharray = `${len}`;
    path.style.strokeDashoffset = `${len}`;
    const dot = make("circle", { r: 7, class: "hl-parcel" }, arcs);
    flights.push({ c, path, dot, len, t0: performance.now() });
  }
  function land(f) {
    f.dot.remove();
    f.path.classList.add("done");
    f.c.g.classList.add("on");
    setTimeout(() => f.c.g.classList.remove("on"), 2600);
    trail.push(f.path);
    if (trail.length > MAX_ARCS) trail.shift().remove();
  }

  let running = false, raf = 0, next = 0, turn = 0;
  function frame(now) {
    raf = 0;
    if (!running) return;
    if (now >= next) { send(cities[turn++ % cities.length]); next = now + GAP; }
    for (let i = flights.length - 1; i >= 0; i--) {
      const f = flights[i];
      const p = Math.min(1, (now - f.t0) / FLY);
      const e = p < .5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
      const at = f.path.getPointAtLength(f.len * e);
      f.dot.setAttribute("cx", at.x); f.dot.setAttribute("cy", at.y);
      f.path.style.strokeDashoffset = `${f.len * (1 - e)}`;
      if (p === 1) { land(f); flights.splice(i, 1); }
    }
    raf = requestAnimationFrame(frame);
  }
  let inView = false;
  const sync = () => {
    const go = inView && !document.hidden;
    if (go === running) return;
    running = go;
    if (go) {
      // Whatever was mid-air while asleep just restarts its leg rather than jumping to the end.
      const now = performance.now();
      flights.forEach((f) => { f.t0 = now; });
      next = Math.max(next, now + 300);
      raf = raf || requestAnimationFrame(frame);
    }
  };
  new IntersectionObserver(([e]) => { inView = e.isIntersecting; sync(); }).observe(box);
  document.addEventListener("visibilitychange", sync);
  cities.forEach((c) => { c.g.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse" && running) { send(c); next = performance.now() + GAP; } }); });
})();
