// Page motion for v5: things rise in as they scroll into view (cards one after another), the
// banner drifts with the scroll, tiles tilt toward the mouse, the header lifts once you scroll.
// Nothing is hidden unless this script runs; all of it is off for reduced motion.
(() => {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  document.documentElement.classList.add("motion");

  // What rises in. Items in the same row start one after another.
  const PICK = [
    ".sec-head", ".trust > div", "#grid .card", ".panel",
    ".look", ".vid-row", ".how li", ".store-card", ".foot-grid > div", ".more-wrap",
  ].join(",");

  let io = null;
  function scan() {
    if (!io) return;
    for (const el of document.querySelectorAll(PICK)) {
      if (el.dataset.rv) continue;
      el.dataset.rv = "1";
      const sibs = el.parentElement ? [...el.parentElement.children].filter((c) => c.matches(PICK)) : [];
      el.style.setProperty("--rv-d", `${Math.min(sibs.indexOf(el), 9) * 70}ms`);
      io.observe(el);
    }
  }
  function start() {
    io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const row = e.target.parentElement;
        // a row that scrolls sideways comes in whole, or its off-screen items would wait for a swipe
        const items = row && row.scrollWidth > row.clientWidth + 2 ? [...row.children].filter((c) => c.dataset.rv) : [e.target];
        for (const el of items) { el.classList.add("in"); io.unobserve(el); }
      }
    }, { rootMargin: "0px 0px -6% 0px", threshold: .08 });
    scan();
    // the rack and tiles are redrawn as stock changes; pick up new pieces too
    new MutationObserver(() => scan()).observe(document.querySelector("main"), { childList: true, subtree: true });
  }
  // Wait for the opening map to lift, so the first screen animates in as it fades.
  const ready = () => !document.body.classList.contains("vxi-on");
  if (ready()) start();
  else {
    const mo = new MutationObserver(() => { if (ready()) { mo.disconnect(); setTimeout(start, 120); } });
    mo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }

  // Header shadow + banner parallax.
  const top = document.querySelector(".top");
  let ticking = false;
  addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = scrollY;
      top && top.classList.toggle("scrolled", y > 8);
      ticking = false;
    });
  }, { passive: true });

  // Tilt: tiles lean toward the pointer (mouse only).
  // The truck by the "Fresh off the truck" heading: scrolling down drives it right and off the screen,
  // gone just as the heading slides under the top bar. Scrolling back up brings it home.
  const truck = document.querySelector(".truck");
  if (truck) {
    const road = truck.parentElement;
    const wheels = truck.querySelectorAll(".truck-wheel");
    const trail = truck.querySelector(".truck-swoosh");
    let queued = false;
    const drive = () => {
      queued = false;
      const box = road.getBoundingClientRect();
      const end = Math.max(120, box.top + scrollY - 66);
      const p = Math.min(1, scrollY / end);
      const x = Math.pow(p, 1.5) * (innerWidth - box.left + 40);
      truck.style.transform = p ? `translateX(${x.toFixed(1)}px) skewX(${(-14 * Math.min(1, p * 2.5)).toFixed(1)}deg)` : "";
      truck.style.visibility = p === 1 ? "hidden" : "";
      trail.style.opacity = p > .04 ? ".6" : "";
      wheels.forEach((w) => { w.style.transform = `rotate(${(x * 3).toFixed(0)}deg)`; });
    };
    const queue = () => { if (!queued) { queued = true; requestAnimationFrame(drive); } };
    addEventListener("scroll", queue, { passive: true });
    addEventListener("resize", queue, { passive: true });
    drive();
  }

  if (matchMedia("(hover: hover) and (pointer: fine)").matches) {
    document.addEventListener("pointermove", (e) => {
      const t = e.target.closest(".look");
      document.querySelectorAll(".tilting").forEach((x) => { if (x !== t) { x.classList.remove("tilting"); x.style.transform = ""; } });
      if (!t) return;
      const r = t.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - .5, py = (e.clientY - r.top) / r.height - .5;
      t.classList.add("tilting");
      t.style.transform = `perspective(700px) rotateX(${(-py * 9).toFixed(2)}deg) rotateY(${(px * 11).toFixed(2)}deg) translateZ(0)`;
    });
  }
})();
