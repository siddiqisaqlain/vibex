// What visitors do on the shop, for the owner's /analytics page. Anonymous on purpose: a random
// id in this browser, no cookies, and nothing typed into a form is ever kept: only which box, how
// long it took, how many keys and corrections, and whether it ended up empty.
// Shared by every design, like newtab.js. window.VXTrack lets checkout report its steps.
(() => {
  const noop = () => {};
  window.VXTrack = noop;
  const blocked = () => { try { return localStorage.getItem("vx-no-track") === "1"; } catch { return false; } };
  if (blocked() || navigator.webdriver || navigator.globalPrivacyControl || location.pathname.startsWith("/preview")) return;

  const VISIT_GAP = 30 * 60e3, BEAT = 15e3;
  const rid = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
  // One visit across tabs: product links open in a new tab, and that isn't a new visit.
  function ids() {
    let a = null;
    try { a = JSON.parse(localStorage.getItem("vx-a") || "null"); } catch { /* private mode */ }
    const now = Date.now(), fresh = !a || !a.v, expired = fresh || now - a.t > VISIT_GAP;
    const out = { v: fresh ? rid() : a.v, s: expired ? rid() : a.s, t: now, isNew: fresh, starts: expired };
    try { localStorage.setItem("vx-a", JSON.stringify({ v: out.v, s: out.s, t: now })); } catch { /* private mode */ }
    return out;
  }
  const id = ids();
  // 15% of visitors never see the guide's help, so its effect can be measured fairly.
  let arm = "on";
  try { arm = localStorage.getItem("vx-arm") || (Math.random() < 0.15 ? "off" : "on"); localStorage.setItem("vx-arm", arm); } catch { /* private mode */ }
  const hooks = [];
  window.VXOn = (fn) => hooks.push(fn);
  window.VXVisit = { s: id.s, arm, isNew: id.isNew };
  const path = location.pathname;
  const prod = (/^\/p\/([\w-]{1,40})$/.exec(path) || [])[1];

  let queue = [];
  const flush = (leaving) => {
    if (!queue.length) return;
    const at = Date.now();
    const body = JSON.stringify({ v: id.v, s: id.s, ev: queue.map(({ _t, ...e }) => ({ ...e, d: at - _t })) });
    queue = [];
    // text/plain keeps this a simple request; a beacon survives the page closing.
    if (leaving && navigator.sendBeacon?.("/api/t", new Blob([body], { type: "text/plain" }))) return;
    fetch("/api/t", { method: "POST", headers: { "Content-Type": "text/plain" }, body, keepalive: true }).catch(noop);
  };
  const send = (e, data = {}) => { queue.push({ e, p: path, ...data, _t: Date.now() }); for (const h of hooks) h(e, data); if (queue.length >= 12) flush(); };
  let timer = null;
  const soon = (e, data) => { send(e, data); clearTimeout(timer); timer = setTimeout(flush, 800); };

  // ---- the visit itself ----
  const q = new URLSearchParams(location.search);
  send("page", {
    pr: prod, title: document.title.slice(0, 80), ref: document.referrer && !document.referrer.startsWith(location.origin) ? new URL(document.referrer).hostname : "",
    utm: q.get("utm_source") || "", camp: q.get("utm_campaign") || "", w: innerWidth, h: innerHeight, net: navigator.connection?.effectiveType || "", arm, lang: navigator.language || "",
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "", nw: id.isNew ? 1 : 0, st: id.starts ? 1 : 0,
  });
  flush();

  // Time is only counted while the page is on screen and the person has done something lately.
  let shown = Date.now(), active = 0, deep = 0, lastInput = Date.now();
  const tally = () => { if (!document.hidden && shown) { const n = Date.now(); if (n - lastInput < 60e3) active += n - shown; shown = n; } };
  const scrolled = () => {
    const h = document.documentElement.scrollHeight - innerHeight;
    deep = Math.max(deep, h > 0 ? Math.min(100, Math.round((scrollY / h) * 100)) : 100);
  };
  for (const ev of ["pointerdown", "keydown", "touchstart"]) addEventListener(ev, () => (lastInput = Date.now()), { passive: true });
  addEventListener("scroll", () => { lastInput = Date.now(); scrolled(); }, { passive: true });
  const beat = (e) => { tally(); ids(); send(e, { n: Math.round(active), sc: deep }); active = 0; };
  let vitalsSent = false;
  const sendVitals = () => { if (vitalsSent) return; vitalsSent = true; const nav = performance.getEntriesByType?.("navigation")?.[0]; send("vit", { lcp: vitals.lcp, inp: vitals.inp, cls: Math.round(vitals.cls * 1000), ttfb: nav ? Math.round(nav.responseStart) : undefined }); };
  const pulse = setInterval(() => { if (!document.hidden) { beat("beat"); flush(); } }, BEAT);
  let closeAll = noop; // ends the section and form box being timed, set further down
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { closeAll(); sendVitals(); beat("beat"); flush(true); } else { shown = Date.now(); beat("beat"); flush(); }
  });
  addEventListener("pagehide", () => { clearInterval(pulse); closeAll(); sendVitals(); beat("leave"); flush(true); });

  addEventListener("load", () => setTimeout(() => {
    const nav = performance.getEntriesByType?.("navigation")?.[0];
    if (nav?.loadEventEnd > 0) soon("perf", { n: Math.round(nav.loadEventEnd) });
  }, 0));
  // Only this site's own files. Instagram and Facebook inject scripts into their in-app browser, and
  // those scripts' crashes have no file of ours. The file and line make a real one findable.
  addEventListener("error", (e) => {
    if (!e.message || !e.filename?.startsWith(location.origin)) return;
    const at = e.filename.slice(location.origin.length).split("?")[0];
    soon("err", { x: `${`${e.message}`.slice(0, 90)} (${at}:${e.lineno || 0})` });
  });
  // How the page felt: when the main content appeared, how long a press took to answer, and how much it jumped around.
  const vitals = { lcp: 0, inp: 0, cls: 0 };
  const see = (type, fn, extra = {}) => { try { new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true, ...extra }); } catch { /* an older browser */ } };
  see("largest-contentful-paint", (e) => (vitals.lcp = Math.round(e.startTime)));
  see("event", (e) => (vitals.inp = Math.max(vitals.inp, Math.round(e.duration))), { durationThreshold: 40 });
  see("layout-shift", (e) => { if (!e.hadRecentInput) vitals.cls += e.value; });

  // How far down the page people get, section by section.
  const seen = new Set();
  const watch = () => {
    if (!window.IntersectionObserver) return;
    const io = new IntersectionObserver((list) => {
      for (const it of list) {
        if (!it.isIntersecting) continue;
        const name = it.target.id || it.target.classList[0];
        if (name && !seen.has(name)) { seen.add(name); send("section", { x: name }); }
        io.unobserve(it.target);
      }
    }, { threshold: 0.25 });
    document.querySelectorAll("main > section").forEach((el) => io.observe(el));
  };
  addEventListener("DOMContentLoaded", watch);
  if (document.readyState !== "loading") watch();

  // ---- exactly where, and for how long ----
  // The part of the page filling most of the screen. Time counts only while it's on screen and in use.
  const PARTS = [[".pdp-media", "photos"], [".pdp-desc", "description"], [".pdp-sizes", "sizes"], [".pdp-facts", "facts"], [".related", "related"]];
  const parts = () => {
    const out = [...document.querySelectorAll("main > section")].map((el) => [el, el.id || el.classList[0]]);
    for (const [sel, name] of PARTS) { const el = document.querySelector(sel); if (el) out.push([el, name]); }
    return out;
  };
  const mainPart = () => {
    if (document.querySelector("dialog[open]")) return ""; // the order form has its own timing
    let best = "", most = 0;
    for (const [el, name] of parts()) {
      if (!name || !el.offsetHeight) continue;
      const r = el.getBoundingClientRect(), shown = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
      if (shown > most) { most = shown; best = name; }
    }
    return best;
  };
  let part = null, maybe = "", box = null, lastTick = Date.now();
  const closePart = () => { if (part?.ms >= 500) send("sec", { x: part.x, n: Math.round(part.ms), pk: part.pk, rv: part.rv }); part = null; };
  // How much of a section has passed through the screen, and how often they scrolled back up inside it.
  let lastY = scrollY, goingUp = false;
  const partEl = (x) => parts().find(([, n]) => n === x)?.[0];
  const watchPart = () => {
    if (!part) return;
    const el = partEl(part.x); if (!el) return;
    const r = el.getBoundingClientRect(), seen = Math.round(Math.max(0, Math.min(100, ((innerHeight - r.top) / Math.max(1, r.height)) * 100)));
    part.pk = Math.max(part.pk || 0, seen);
    const up = scrollY < lastY - 20, down = scrollY > lastY + 20;
    if (up && !goingUp) { part.rv = (part.rv || 0) + 1; goingUp = true; } else if (down) goingUp = false;
    if (up || down) lastY = scrollY;
  };
  const closeBox = () => {
    if (!box) return;
    const b = box; box = null;
    soon("field", { x: b.x, n: Math.round(b.ms), ed: b.ed, del: b.del, fl: b.el.value ? 1 : 0, fk: b.fk, pa: b.pa, au: b.au, bad: b.el.validity && !b.el.validity.valid ? 1 : 0, st2: b.form });
  };
  closeAll = () => { closeBox(); closePart(); };
  setInterval(() => {
    const now = Date.now(), dt = Math.min(now - lastTick, 2000);
    lastTick = now;
    if (document.hidden) return;
    if (now - lastInput < 60e3) { if (part) part.ms += dt; if (box) box.ms += dt; }
    watchPart();
    // Half a second to settle, so a fast scroll past a section doesn't count as a stop.
    const c = mainPart();
    if (c === (part?.x || "")) { maybe = ""; return; }
    if (c !== maybe) { maybe = c; return; }
    maybe = ""; closePart();
    if (c) { part = { x: c, ms: 0 }; soon("in", { x: c }); }
  }, 500);

  // Which products were on screen, and for how long, so "seen" can be set against "tapped".
  if (window.IntersectionObserver) {
    const open = new Map(), known = new WeakSet();
    const pidOf = (el) => el.dataset.id || (/\/p\/([\w-]{1,40})/.exec(el.getAttribute("href") || "") || [])[1];
    const shut = (el) => { const at = open.get(el); open.delete(el); if (at && Date.now() - at >= 700) send("card", { pr: pidOf(el), n: Date.now() - at }); };
    const io = new IntersectionObserver((list) => { for (const it of list) { if (it.isIntersecting && !document.hidden) open.set(it.target, Date.now()); else shut(it.target); } }, { threshold: 0.6 });
    const scan = () => { for (const el of document.querySelectorAll("article.card[data-id],a.mini")) if (!known.has(el)) { known.add(el); io.observe(el); } };
    const was = closeAll;
    closeAll = () => { for (const el of [...open.keys()]) shut(el); was(); };
    new MutationObserver(() => { clearTimeout(scan.t); scan.t = setTimeout(scan, 400); }).observe(document.documentElement, { childList: true, subtree: true });
    scan();
  }

  // ---- what they press ----
  // A short name for an element. Only labels the shop itself wrote: never a form value.
  const nameOf = (el) => {
    if (!el?.closest) return "page";
    if (el.closest(".vx-sale")) return "Just bought banner"; // its text has a real customer's name in it
    const named = el.closest("button,a,[id],section,[class]");
    if (!named) return el.tagName.toLowerCase();
    const said = (x) => (x.getAttribute?.("aria-label") || x.getAttribute?.("alt") || x.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
    const label = named.matches("button,a") ? said(named) : el.closest("form") ? "" : said(el);
    const place = el.closest("section,dialog,header,footer");
    const where = place ? (place.id || place.classList[0] || place.tagName.toLowerCase()) : "";
    return [where, label || named.id || `${named.tagName.toLowerCase()}.${named.classList[0] || ""}`].filter(Boolean).join(": ").slice(0, 60);
  };
  const LIVE_TAGS = "a,button,input,select,textarea,label,summary,dialog,[role=button],[role=tab],[onclick],[data-order],[data-ask]";
  let burst = [];
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!t?.closest || t.closest("[data-vx-skip]")) return;
    // the same spot pressed again and again: something isn't answering them.
    // detail 0 is the Enter key or a script, which have no real position.
    const now = Date.now();
    if (e.detail) burst = burst.filter((c) => now - c.t < 900 && Math.abs(c.x - e.clientX) < 30 && Math.abs(c.y - e.clientY) < 30);
    if (e.detail) burst.push({ t: now, x: e.clientX, y: e.clientY });
    if (e.detail && burst.length === 3) soon("rage", { x: nameOf(t) });
    const inSection = t.closest("section,.pdp-media,.pdp-info"), rect = inSection?.getBoundingClientRect();
    const spot = rect?.height && e.detail ? { z: part?.x, sx: Math.round(((e.clientX - rect.left) / rect.width) * 100), sy: Math.round(((e.clientY - rect.top) / rect.height) * 100) } : {};
    if (t.closest("a,button,summary,[role=button],[role=tab]")) send("tap", { x: nameOf(t), ...spot });

    const a = t.closest("a[href]"), href = a?.getAttribute("href") || "";
    const pid = (/^(?:\/preview\/\w+)?\/p\/([\w-]{1,40})/.exec(href) || [])[1];
    if (pid) soon("pclick", { pr: pid, x: nameOf(t).split(":")[0] });
    else if (/wa\.me|whatsapp/i.test(href)) soon("wa", { pr: prod });
    else if (/instagram\.com|ig\.me/i.test(href)) soon("ig", { pr: prod });
    else if (/google\.[^/]+\/maps|maps\.app|goo\.gl/i.test(href)) soon("map");
    else if (/^tel:/.test(href)) soon("call");
    else if (t.closest("#vid-btn")) soon("video");
    else if (t.closest("#vid-more,[href*='youtube.com']")) soon("yt");
    else if (t.closest("[data-ask]")) soon("enq_open", { pr: t.closest("[data-ask]").dataset.ask });
    else if (t.closest("#filters button,#subs button,.range-row a,.range-row button")) soon("filter", { x: (t.closest("button,a").textContent || "").trim().replace(/\s+/g, " ").slice(0, 40) });
    else if (t.closest("[data-copy]")) soon("copy", { x: (t.closest("[data-copy]").getAttribute("aria-label") || "payment detail").slice(0, 40) });

    // A press that did nothing: not a control, and nothing on the page changed.
    if (!t.closest(LIVE_TAGS) && /^(IMG|H1|H2|H3|H4|B|SPAN|P|LI|SVG|EM)$/i.test(t.tagName)) {
      const was = nameOf(t);
      let moved = false;
      const mo = new MutationObserver(() => (moved = true));
      mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "open", "hidden"] });
      setTimeout(() => { mo.disconnect(); if (!moved && !document.hidden) soon("dead", { x: was }); }, 500);
    }
  }, true);

  // Forms: each box, its time, keys and corrections. Names of boxes and counts, never contents.
  let lastField = "";
  const isBox = (el) => el.matches?.("input,select,textarea") && !el.closest(".vx-ask,[data-vx-skip]") && !el.classList.contains("ask-trap");
  document.addEventListener("focusin", (e) => {
    if (!isBox(e.target)) return;
    closeBox();
    const el = e.target, x = lastField = el.name || el.id || el.type, dlg = el.closest("dialog");
    box = { el, x, ms: 0, ed: 0, del: 0, fk: 0, pa: 0, au: 0, at: Date.now(), form: dlg?.classList.contains("co-dialog") ? "checkout" : dlg ? "enquiry" : "other" };
    soon("fin", { x });
  });
  document.addEventListener("focusout", (e) => { if (box?.el === e.target) closeBox(); });
  document.addEventListener("input", (e) => {
    if (box?.el !== e.target) return;
    if (!box.fk) box.fk = Date.now() - box.at; // how long they sat looking at the box before starting
    const kind = e.inputType || "";
    if (kind === "insertFromPaste") box.pa = 1; else if (!kind || kind === "insertReplacementText") box.au = 1; // pasted, or filled in by the phone
    box.ed++; if (kind.startsWith("delete")) box.del++;
  });
  document.addEventListener("change", (e) => { if (e.target.type === "radio" && e.target.name === "delivery") soon("choice", { x: "delivery", r: e.target.value }); });
  document.addEventListener("invalid", (e) => soon("invalid", { x: e.target.name || e.target.type || "field" }), true);

  // ---- checkout steps (checkout.js and order.js call these) ----
  const opened = Date.now();
  let co = null, thanked = null; // the "how was it" waits for the checkout box to close: nothing shows above it
  const track = (step, data = {}) => {
    if (step === "checkout") { co = { pr: data.pr, step: "details", at: Date.now(), n: data.n }; lastField = ""; soon("checkout", { ...data, ms: Date.now() - opened }); return; }
    if (step === "details") { closeBox(); const ms = co ? Date.now() - co.at : undefined; if (co) { co.step = "pay"; co.at = Date.now(); } soon("details", { ...data, ms }); return; }
    if (step === "paid") { const pr = co?.pr ?? data.pr, ms = co ? Date.now() - co.at : undefined; co = null; thanked = { pr }; soon("paid", { ...data, pr, ms }); return; }
    if (step === "co_close") {
      closeBox();
      if (thanked) { ask("done", thanked.pr); thanked = null; }
      if (!co) return;
      const was = co; co = null;
      soon("abandon", { pr: was.pr, x: was.step, f: was.step === "details" ? lastField : "", n: Date.now() - was.at });
      ask("stop", was.pr, was.step);
      return;
    }
    soon(step, data);
  };
  window.VXTrack = track;
  // The lab (lib/lab-client.js) reports test exposures through the same queue.
  window.VXSend = (e, data) => { if (e === "xp") soon(e, data); };

  // ---- asking them directly ----
  // One tap, skippable, never more than once a day. Written answers are kept for the owner.
  const ASK = {
    stop: { h: "Quick one: what stopped you?", sub: "It helps us fix it. One tap is plenty.", opts: [["price", "Price or offer"], ["shipping", "Delivery cost or time"], ["trust", "Not sure about paying online"], ["payment", "Payment didn't work"], ["size", "Size or details unclear"], ["later", "Just looking, maybe later"]] },
    done: { h: "How was ordering from us?", sub: "One tap.", opts: [["good", "😊 Easy"], ["ok", "😐 Okay"], ["bad", "😞 Hard"]] },
    open: { h: "How's the site? Tell us", sub: "Something confusing, missing, or you liked it.", opts: [["good", "😊 Good"], ["ok", "😐 Okay"], ["bad", "😞 Stuck"]] },
  };
  function ask(kind, pr, step, force) {
    try {
      const day = new Date().toDateString();
      if (!force && localStorage.getItem("vx-asked") === day) return;
      localStorage.setItem("vx-asked", day);
    } catch { /* private mode */ }
    const A = ASK[kind];
    document.querySelector(".vx-ask")?.remove();
    const box = document.createElement("aside");
    box.className = "vx-ask"; box.setAttribute("data-vx-skip", ""); box.setAttribute("role", "dialog"); box.setAttribute("aria-label", A.h);
    box.style.cssText = "position:fixed;left:12px;right:12px;bottom:12px;max-width:380px;margin-left:auto;z-index:2147483000;background:#fff;color:#111;border:1px solid #111;border-radius:10px;padding:14px;box-shadow:0 10px 30px rgba(0,0,0,.25);font:15px/1.35 system-ui,sans-serif";
    const btn = "min-height:44px;padding:8px 12px;border:1px solid #bbb;border-radius:8px;background:#fff;color:#111;font:inherit;cursor:pointer;text-align:left";
    box.innerHTML = `<button type="button" data-x aria-label="Close" style="position:absolute;right:6px;top:4px;width:44px;height:44px;border:0;background:none;font-size:20px;cursor:pointer">×</button>
      <b style="display:block;padding-right:36px"></b><p style="margin:4px 0 10px;color:#555;font-size:13px"></p><div data-o style="display:grid;gap:6px"></div>`;
    box.querySelector("b").textContent = A.h;
    box.querySelector("p").textContent = A.sub;
    const row = box.querySelector("[data-o]");
    for (const [val, label] of A.opts) {
      const b = document.createElement("button");
      b.type = "button"; b.style.cssText = btn; b.textContent = label;
      b.onclick = () => pickNote(val);
      row.appendChild(b);
    }
    const close = () => box.remove();
    box.querySelector("[data-x]").onclick = close;
    function pickNote(val) {
      const done = (note) => { soon("fb", { x: kind, r: val, note, pr, st2: step }); box.querySelector("b").textContent = "Thank you."; box.querySelector("p").textContent = ""; row.remove(); setTimeout(close, 1400); };
      if (val === "later" || val === "good" && kind === "done") return done("");
      box.querySelector("b").textContent = val === "good" ? "What did you like?" : "What happened?";
      box.querySelector("p").textContent = "Optional. Please don't type phone numbers or payment details.";
      row.innerHTML = `<textarea maxlength="300" rows="3" aria-label="Your note" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #bbb;border-radius:8px;font:16px/1.3 system-ui,sans-serif"></textarea>
        <button type="button" style="${btn};background:#111;color:#fff;text-align:center">Send</button>`;
      row.querySelector("button").onclick = () => done(row.querySelector("textarea").value);
    }
    document.body.appendChild(box);
  }
  // Anywhere on the site: <a data-vx-feedback>
  document.addEventListener("click", (e) => {
    if (e.target.closest?.("[data-vx-feedback]")) { e.preventDefault(); ask("open", prod, "", true); }
  });
})();
