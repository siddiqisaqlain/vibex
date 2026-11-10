// The lab in the visitor's browser (served at /lab.js after track.js): A/B tests on the home page hero, and
// screen recordings of a share of visits. Off whenever track.js is off (Global Privacy Control, vx-no-track,
// automated browsers, /preview), because both report through it.
(() => {
  const L = window.SHOP && window.SHOP.lab;
  const send = window.VXSend;
  if (!L || !send || !window.VXVisit) return;
  const path = location.pathname;
  let v = "";
  try { v = (JSON.parse(localStorage.getItem("vx-a") || "{}").v) || ""; } catch { /* private mode */ }
  const s = window.VXVisit.s;
  if (!/^[a-f0-9]{16}$/.test(v) || !/^[a-f0-9]{16}$/.test(s)) return;
  // A steady 0-99 from a string: the same visitor always lands in the same version.
  const bucket = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) % 100; };

  // ---- what kinds of piece this visitor has looked at, kept in their own browser (for "people who looked at X") ----
  const CATS = "vx-cats";
  const seen = () => { try { return JSON.parse(localStorage.getItem(CATS) || "{}"); } catch { return {}; } };
  const prod = (/^\/p\/([\w-]{1,40})$/.exec(path) || [])[1];
  if (prod) fetch("/api/products").then((r) => (r.ok ? r.json() : [])).then((list) => {
    const p = (Array.isArray(list) ? list : []).find((x) => x.id === prod);
    if (!p || !p.category) return;
    const c = seen(); c[p.category] = Date.now();
    try { localStorage.setItem(CATS, JSON.stringify(c)); } catch { /* private mode */ }
  }).catch(() => {});

  // ---- tests: the home page hero ----
  const hero = document.querySelector(".hero-copy");
  if (hero && Array.isArray(L.tests)) {
    const month = Date.now() - 30 * 864e5, cats = seen();
    const fits = (a) => !a || (a === "new" ? window.VXVisit.isNew : a === "returning" ? !window.VXVisit.isNew : a.startsWith("cat:") ? (cats[a.slice(4)] || 0) > month : false);
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const apply = (c) => {
      if (!c) return;
      const h1 = hero.querySelector("h1"), lede = hero.querySelector(".lede"), cta = hero.querySelector(".cta .btn");
      if (h1 && c.headline) h1.innerHTML = esc(c.headline) + (c.headline2 ? `<br><span>${esc(c.headline2)}</span>` : "");
      if (lede && c.lede) lede.textContent = c.lede;
      if (cta && c.cta && cta.firstChild) cta.firstChild.textContent = c.cta + " ";
      if (cta && c.jump) cta.dataset.jump = c.jump;
    };
    // A test for a narrow audience (a category, returning visitors) goes before one for everybody.
    const order = (t) => (t.audience ? 0 : 1);
    for (const t of L.tests.slice().sort((a, b) => order(a) - order(b))) {
      if (!fits(t.audience)) continue;
      if (t.status === "kept") { apply(t.variants[0] && t.variants[0].content); break; }
      const key = bucket(v + t.id) < 50 ? "a" : "b";
      const variant = t.variants.find((x) => x.key === key);
      if (variant) apply(variant.content);
      send("xp", { x: t.id, r: key });
      break;
    }
  }

  // ---- recordings: a share of visits, decided once per visit ----
  const PRIVATE = /^\/(account|bill|billing|analytics|demo|owner|portal)(\/|$)/;
  const rate = Math.max(0, Math.min(100, Number(L.rec) || 0));
  if (!rate || PRIVATE.test(path) || bucket(s + "rec") >= rate) return;
  const script = document.createElement("script");
  script.src = "/rec.js";
  script.async = true;
  script.onload = () => {
    const R = window.rrwebRecord, rec = R && (typeof R.record === "function" ? R.record : R);
    if (typeof rec !== "function") return;
    let buf = [], size = 0, total = 0, stopped = false;
    const LIMIT = 3.5 * 1024 * 1024, started = Date.now();
    // Leaving a page, browsers only carry small parcels (about 60 KB), so the page's big first picture
    // goes as soon as it's taken, and what's left at the end goes in small pieces.
    const ship = (events, leaving) => {
      const body = JSON.stringify({ s, v, p: path, w: innerWidth, ev: events });
      total += body.length;
      const small = body.length < 60000;
      if (leaving && small && navigator.sendBeacon && navigator.sendBeacon("/api/rec", new Blob([body], { type: "text/plain" }))) return;
      fetch("/api/rec", { method: "POST", headers: { "Content-Type": "text/plain" }, body, keepalive: small }).catch(() => {});
    };
    const post = (leaving) => {
      if (!buf.length) return;
      const all = buf; buf = []; size = 0;
      if (!leaving) return ship(all, false);
      let part = [], bytes = 0;
      for (const e of all) {
        const n = JSON.stringify(e).length;
        if (part.length && bytes + n > 50000) { ship(part, true); part = []; bytes = 0; }
        part.push(e); bytes += n;
      }
      if (part.length) ship(part, true);
    };
    const stop = rec({
      emit(e) {
        if (stopped) return;
        buf.push(e); size += 200;
        if (e.type === 2) { post(); return; } // the full picture of the page: send it now, while the page is open
        if (total > LIMIT || Date.now() - started > 20 * 60e3) { stopped = true; post(); if (stop) stop(); return; }
        if (buf.length >= 300) post();
      },
      maskAllInputs: true,                                             // nothing typed is ever recorded
      maskTextSelector: "dialog, .co-dialog, .acct, [data-vx-mask]",  // names, numbers, addresses in checkout
      blockSelector: "[data-vx-block], iframe, video",
      slimDOMOptions: "all",
      inlineStylesheet: false, // the replay loads the shop's own stylesheet; saves most of the size
      recordCanvas: false,
      collectFonts: false,
      sampling: { mousemove: 80, scroll: 150, input: "last", media: 800 },
    });
    setInterval(() => post(), 10e3);
    addEventListener("pagehide", () => post(true));
    document.addEventListener("visibilitychange", () => { if (document.hidden) post(true); });
  };
  document.head.appendChild(script);
})();
