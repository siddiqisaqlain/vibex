// Helps a visitor at the moment they're likely to stall. Works out their chance of buying here in their own
// browser, from what they've done on this visit, using a model of past visits that holds nothing personal.
// It only ever shows true facts from shop.json and real stock. It cannot change a price, and has no way to:
// the amount of an order is worked out on the server alone. 15% of visitors see nothing, so we can tell if it helps.
(() => {
  const V = window.VXVisit, track = window.VXTrack, S = window.SHOP || {};
  if (!V || !window.VXOn) return; // no tracking wanted, so no guiding either
  const on = V.arm === "on", MAX = 3, path = location.pathname, pid = (/^\/p\/([\w-]{1,40})$/.exec(path) || [])[1];
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
  let sig = load("vx-g-visit", null);
  if (sig?.s !== V.s) sig = { s: V.s, on: {}, products: [], time: 0, rack: 0, fired: {}, sent: 0 };
  const mark = (k) => { sig.on[k] = 1; };
  const ua = navigator.userAgent, ref = document.referrer;
  if (/Mobi|Android|iPhone/i.test(ua)) mark("phone");
  if (/Instagram/i.test(ua)) mark("insta");
  if (/google|bing|duckduckgo/i.test(ref)) mark("search");
  if (!V.isNew) mark("back");
  if (pid && !sig.products.includes(pid)) sig.products.push(pid);
  if (sig.products.length >= 2) mark("two");
  if (pid) save("vx-g-seen", { id: pid, at: Date.now() });

  // ---- the prediction ----
  const STARTER = { ready: false, base: -3.5, w: { co: 3, dt: 1.2, long: 0.6, sizes: 0.5, back: 0.5, two: 0.4, desc: 0.3, rack: 0.2, filt: 0.2, stuck: -0.4 } };
  let model = STARTER;
  fetch("/api/guide").then((r) => r.json()).then((m) => { if (m?.w) model = m; }).catch(() => {});
  const chance = () => { let x = model.base; for (const k of Object.keys(sig.on)) x += model.w[k] || 0; return Math.round((1 / (1 + Math.exp(-x))) * 100); };
  const report = () => { const p = chance(); if (Math.abs(p - sig.sent) >= 5 || !sig.sent) { sig.sent = p || 1; track("pred", { pb: p }); } };
  window.VXOn((e, d) => {
    if (e === "sec") { if (d.x === "sizes") mark("sizes"); if (d.x === "description") mark("desc"); if (d.x === "rack") { sig.rack += d.n || 0; if (sig.rack >= 20e3) mark("rack"); } }
    else if (e === "filter") mark("filt");
    else if (["rage", "dead", "invalid", "formerr", "err"].includes(e)) mark("stuck");
    else if (e === "checkout") mark("co");
    else if (e === "details") mark("dt");
    else return;
    save("vx-g-visit", sig); if (pid) report();
  });

  // ---- the help ----
  const css = document.createElement("style");
  css.textContent = `.vx-g{display:flex;gap:10px;align-items:flex-start;margin:12px 0;padding:10px 12px;border:1px solid var(--line-2,#ccc);border-radius:6px;background:var(--card,#fff);color:var(--ink,#111);font:14px/1.4 var(--body,system-ui,sans-serif)}.vx-g b{display:block;font-weight:600}.vx-g a{color:inherit;text-decoration:underline}.vx-g button{margin-left:auto;flex:none;width:32px;height:32px;margin-top:-6px;margin-right:-6px;border:0;background:none;color:inherit;font-size:18px;cursor:pointer}.vx-g.float{position:fixed;left:12px;right:12px;bottom:12px;margin:0;max-width:360px;z-index:40;box-shadow:0 8px 24px rgba(0,0,0,.16)}@media print{.vx-g{display:none}}`;
  document.head.append(css);
  const waLink = (text) => { const n = String(S.whatsapp || "").replace(/\D/g, ""); return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : ""; };
  const count = () => Object.keys(sig.fired).length;
  let shown = null;
  // Everyone who reaches the moment is counted; only those in the "on" group see anything.
  function fire(id, build) {
    if (sig.fired[id] || count() >= MAX) return false;
    sig.fired[id] = 1; save("vx-g-visit", sig);
    if (!on) { track("nudge", { x: id, ctl: 1 }); return true; }
    track("nudge", { x: id });
    shown = { id, build, el: null, closed: false }; place();
    return true;
  }
  function place() { // the product page redraws itself, so the note is put back if it goes
    if (!shown || shown.closed || (shown.el && document.contains(shown.el))) return;
    const made = shown.build(); if (!made) return;
    const { html, at, float } = made, el = document.createElement("div");
    el.className = `vx-g${float ? " float" : ""}`; el.setAttribute("role", "status"); el.setAttribute("data-vx-skip", "");
    el.innerHTML = `<div>${html}</div><button type="button" aria-label="Close">×</button>`;
    el.querySelector("button").onclick = () => { shown.closed = true; el.remove(); };
    el.querySelector("a")?.addEventListener("click", () => track("nudge_tap", { x: shown.id }));
    if (float) { if (pid) el.style.bottom = "92px"; document.body.append(el); } else if (at) at.before(el); else return; // above the Order now bar, wherever they've scrolled to
    shown.el = el;
  }
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const name = () => document.querySelector(".pdp-info h1")?.textContent?.trim() || "this piece";
  const busy = () => document.querySelector(".vxi,.vx-hi,.vx-ask,.vx-sale");
  const P = S.policy || {};
  const facts = () => [P.changeOfMindDays && `Returns within ${P.changeOfMindDays} days if unused`, P.deliveryDays && `delivered in ${P.deliveryDays} days`].filter(Boolean).join(", ");
  const NOTES = {
    size_help: () => ({ float: true, html: `<b>Not sure about the size?</b><a href="${esc(waLink(`Hi, can you help with the size of ${name()}?`))}" target="_blank" rel="noopener">Ask us on WhatsApp</a> and we'll check it for you.` }),
    assure: () => ({ float: true, html: `<b>Original piece, from our store in Srinagar.</b>${esc(facts())}. <a href="/returns" target="_blank" rel="noopener">How returns work</a>` }),
    pay_help: () => ({ at: document.querySelector("dialog[open] [data-paid]"), html: `<b>Stuck paying?</b><a href="${esc(waLink("Hi, I'm trying to pay for my order and need help."))}" target="_blank" rel="noopener">Message us on WhatsApp</a> and we'll sort it out with you.` }),
    address_help: () => ({ at: document.querySelector("dialog[open] .co-cta"), html: `<b>Keep it simple.</b>House, street and area is plenty. We'll confirm with you on WhatsApp before we send it.` }),
  };
  let onPage = 0, boxAt = 0, payAt = 0, tried = false;
  setInterval(() => {
    if (document.hidden) return;
    onPage++; place();
    if (shown?.id === "size_help" && document.querySelector(".pdp-sizes .pill.on")) { shown.closed = true; shown.el?.remove(); } // they've chosen, so it's done its job
    if (pid && !document.querySelector("dialog[open]")) { sig.time++; if (sig.time >= 30) mark("long"); }
    const dlg = document.querySelector("dialog[open]");
    if (pid && !dlg && !busy()) {
      const sizes = document.querySelector(".pdp-sizes"), picked = sizes?.querySelector(".pill.on");
      if (sizes && !picked && onPage >= 25) fire("size_help", NOTES.size_help);
      else if (onPage >= 35 && chance() < 70 && facts() && !sig.fired.size_help) fire("assure", NOTES.assure); // one note on a product, so the order form and payment keep theirs
    }
    if (dlg) {
      boxAt = document.activeElement?.name === "address" ? boxAt + 1 : 0;
      if (boxAt >= 15) fire("address_help", NOTES.address_help);
      payAt = dlg.querySelector("[data-paid]") ? payAt + 1 : 0;
      if (payAt >= 45) fire("pay_help", NOTES.pay_help);
    }
    if (path === "/" && !V.isNew && onPage >= 6 && !tried && !busy()) { tried = true; comeBack(); }
    if (onPage % 15 === 0) save("vx-g-visit", sig);
  }, 1000);
  // Someone returning to a piece they looked at, shown only if it's truly still there.
  async function comeBack() {
    const last = load("vx-g-seen", null);
    if (!last || Date.now() - last.at > 7 * 864e5) return;
    const p = (await fetch("/api/products").then((r) => r.json()).catch(() => [])).find((x) => x.id === last.id);
    if (!p || p.status !== "available") return;
    fire("come_back", () => ({ float: true, html: `<b>Still thinking about ${esc(p.name)}?</b>${p.quantity === 1 ? "It's the last one, and it's still here. " : "It's still here. "}<a href="/p/${encodeURIComponent(p.id)}">Take another look</a>` }));
  }
})();
