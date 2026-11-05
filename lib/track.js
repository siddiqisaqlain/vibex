// What visitors do on the shop, for the owner's /analytics page. Anonymous on purpose: a random
// id in this browser, no cookies, and nothing typed into a form is ever read (only which field).
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
  const path = location.pathname;
  const prod = (/^\/p\/([\w-]{1,40})$/.exec(path) || [])[1];

  let queue = [];
  const flush = (leaving) => {
    if (!queue.length) return;
    const body = JSON.stringify({ v: id.v, s: id.s, ev: queue });
    queue = [];
    // text/plain keeps this a simple request; a beacon survives the page closing.
    if (leaving && navigator.sendBeacon?.("/api/t", new Blob([body], { type: "text/plain" }))) return;
    fetch("/api/t", { method: "POST", headers: { "Content-Type": "text/plain" }, body, keepalive: true }).catch(noop);
  };
  const send = (e, data = {}) => { queue.push({ e, p: path, ...data }); if (queue.length >= 12) flush(); };
  let timer = null;
  const soon = (e, data) => { send(e, data); clearTimeout(timer); timer = setTimeout(flush, 800); };

  // ---- the visit itself ----
  const q = new URLSearchParams(location.search);
  send("page", {
    pr: prod, title: document.title.slice(0, 80), ref: document.referrer && !document.referrer.startsWith(location.origin) ? new URL(document.referrer).hostname : "",
    utm: q.get("utm_source") || "", camp: q.get("utm_campaign") || "", w: innerWidth, lang: navigator.language || "",
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
  const pulse = setInterval(() => { if (!document.hidden) { beat("beat"); flush(); } }, BEAT);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { beat("beat"); flush(true); } else { shown = Date.now(); beat("beat"); flush(); }
  });
  addEventListener("pagehide", () => { clearInterval(pulse); beat("leave"); flush(true); });

  addEventListener("load", () => setTimeout(() => {
    const nav = performance.getEntriesByType?.("navigation")?.[0];
    if (nav?.loadEventEnd > 0) soon("perf", { n: Math.round(nav.loadEventEnd) });
  }, 0));
  addEventListener("error", (e) => { if (e.message) soon("err", { x: `${e.message}`.slice(0, 120) }); });

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

  // ---- what they press ----
  // A short name for an element. Only labels the shop itself wrote: never a form value.
  const nameOf = (el) => {
    if (!el?.closest) return "page";
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

  // Forms: where people get stopped, and the last box they were in. Names of boxes, never contents.
  let lastField = "";
  document.addEventListener("focusin", (e) => { if (e.target.matches?.("input,select,textarea")) lastField = e.target.name || e.target.id || e.target.type; });
  document.addEventListener("invalid", (e) => soon("invalid", { x: e.target.name || e.target.type || "field" }), true);

  // ---- checkout steps (checkout.js and order.js call these) ----
  let co = null, thanked = null; // the "how was it" waits for the checkout box to close: nothing shows above it
  const track = (step, data = {}) => {
    if (step === "checkout") { co = { pr: data.pr, step: "details", at: Date.now(), n: data.n }; lastField = ""; soon("checkout", data); return; }
    if (step === "details") { if (co) { co.step = "pay"; co.at = Date.now(); } soon("details", data); return; }
    if (step === "paid") { const pr = co?.pr ?? data.pr; co = null; thanked = { pr }; soon("paid", { ...data, pr }); return; }
    if (step === "co_close") {
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
