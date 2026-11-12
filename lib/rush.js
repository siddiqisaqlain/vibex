// The tension of a shop where every piece is a one-off. Everything here is true: each number comes from the server,
// the countdown is a real hold, and nothing is shown when there's nothing real to show. Every note can be closed, and
// leaving costs nothing. 15% of visitors see none of it, so its effect can be measured.
(() => {
  const V = window.VXVisit, track = window.VXTrack;
  if (!V || !window.VXOn) return;
  // shop.json -> rush.live switches on the live count, the countdown and the ending note. The hold and Next in line always work.
  const live = window.SHOP?.rush?.live === true;
  const on = V.arm === "on", path = location.pathname, pid = (/^\/p\/([\w-]{1,40})$/.exec(path) || [])[1];
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const post = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
  const once = (x) => { const k = `vx-r-${x}`; try { if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, "1"); } catch { /* private mode */ } track("nudge", { x, ...(on ? {} : { ctl: 1 }) }); };
  const css = document.createElement("style");
  css.textContent = `.vx-r{display:flex;align-items:center;gap:8px;margin:10px 0 0;font:600 13.5px/1.3 var(--body,system-ui,sans-serif);color:var(--ink,#111)}.vx-r i{flex:none;width:9px;height:9px;border-radius:50%;background:var(--red,#e2382c);animation:vxr 1.4s infinite}.vx-r.calm i{background:var(--muted,#888);animation:none}@keyframes vxr{50%{opacity:.3}}.vx-hold{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;gap:10px;align-items:center;padding:9px 12px;margin:0 0 10px;background:var(--ink,#111);color:#fff;border-radius:6px;font:600 13.5px/1.3 var(--body,system-ui,sans-serif)}.vx-hold b{font:700 17px var(--mono,monospace);font-variant-numeric:tabular-nums}.vx-won{margin:0 0 12px;padding:10px 12px;border-radius:6px;background:var(--green,#1f7a52);color:#fff;font:600 14.5px/1.35 var(--body,system-ui,sans-serif)}@media (prefers-reduced-motion:reduce){.vx-r i{animation:none}}`;
  document.head.append(css);

  // ---- the chase: who else is here, right now ----
  let pulse = null, seenToday = 0;
  async function readPulse() {
    if (document.hidden) return;
    try { pulse = await fetch(`/api/pulse?id=${encodeURIComponent(pid)}&s=${V.s}`, { cache: "no-store" }).then((r) => r.json()); } catch { return; }
    seenToday = Math.max(seenToday, pulse.today || 0);
    showPulse();
  }
  // Too late for this one: a sold-out link still has somewhere to go, and no pressure.
  function nextInLine() {
    const at = document.querySelector(".pdp-price");
    if (!at || document.querySelector(".vx-next") || !pulse || (pulse.status !== "sold" && pulse.status !== "hold")) return;
    const el = document.createElement("div");
    el.className = "vx-g vx-next"; el.setAttribute("data-vx-skip", "");
    el.innerHTML = `<div style="width:100%"><b>${pulse.status === "sold" ? "This one has gone." : "Someone is buying this right now."}</b>Leave your WhatsApp number and we'll tell you if it comes back. We'll only use it for this.<div style="display:flex;gap:6px;margin-top:8px"><input type="tel" inputmode="numeric" maxlength="14" placeholder="98765 43210" aria-label="Your WhatsApp number" style="flex:1;min-width:0;min-height:44px;padding:8px 10px;border:1px solid var(--line-2,#bbb);border-radius:6px;background:none;color:inherit;font:inherit"><button type="button" style="flex:none;width:auto;height:auto;margin:0;min-height:44px;padding:8px 14px;border-radius:6px;background:var(--ink,#111);color:var(--paper,#fff);font:600 14px inherit">Tell me</button></div><p role="status" style="margin:6px 0 0;font-size:13px"></p></div>`;
    const btn = el.querySelector("button"), msg = el.querySelector("[role=status]");
    btn.onclick = async () => {
      const r = await post("/api/next-in-line", { productId: pid, phone: el.querySelector("input").value }).catch(() => ({ error: "Please try again." }));
      if (r.ok) { el.innerHTML = "<div><b>You're in line.</b>We'll message you on WhatsApp if it comes back.</div>"; track("nudge", { x: "next_in_line" }); } else msg.textContent = r.error;
    };
    at.after(el);
  }
  function showPulse() {
    nextInLine();
    const line = document.querySelector(".vx-r"), at = document.querySelector(".pdp-price");
    const w = pulse?.watching || 0, text = pulse?.heldByOther ? "Someone is ordering this piece right now" : w === 1 ? "1 other person is looking at this right now" : w > 1 ? `${w} other people are looking at this right now` : "";
    if (!live || !on || !text || !at) { line?.remove(); return; }
    const el = line || document.createElement("p");
    el.className = "vx-r"; el.setAttribute("role", "status");
    el.innerHTML = `<i aria-hidden="true"></i><span>${esc(text)}</span>`;
    if (!line) at.after(el);
    once(pulse.heldByOther ? "rival" : "watching");
  }
  if (pid) {
    readPulse(); setInterval(readPulse, 10000);
    setInterval(() => { if (pulse && !document.querySelector(".vx-r") && (pulse.status === "available" || !document.querySelector(".vx-next"))) showPulse(); }, 1000); // the page redraws itself
    const seen = load("vx-r-seen", []).filter((x) => x.id !== pid);
    setTimeout(() => { const name = document.querySelector(".pdp-info h1")?.textContent?.trim(); if (name) save("vx-r-seen", [{ id: pid, name, at: Date.now() }, ...seen].slice(0, 12)); }, 2500);
  }

  // ---- the grab: a real hold, with its real time left ----
  let hold = null, clock = 0;
  const size = () => document.querySelector(".pdp-sizes .pill.on")?.dataset.pick || "";
  function tick() {
    const box = document.querySelector("dialog[open] .vx-hold"), dlg = document.querySelector("dialog.co-dialog[open]");
    if (!hold || !dlg) return;
    const left = hold.until - Date.now() - hold.skew;
    if (left <= 0) { clearInterval(clock); box?.remove(); const el = document.createElement("div"); el.className = "vx-hold"; el.textContent = "Your hold has ended. You can still order if nobody else has taken it."; dlg.prepend(el); track("nudge", { x: "hold_ended" }); return; }
    const m = Math.floor(left / 60e3), s = String(Math.floor(left / 1000) % 60).padStart(2, "0");
    if (box) box.querySelector("b").textContent = `${m}:${s}`;
    else if (on) { const el = document.createElement("div"); el.className = "vx-hold"; el.setAttribute("role", "timer"); el.innerHTML = `<span>The last one is held for you. Nobody else can order it.</span><b>${m}:${s}</b>`; dlg.prepend(el); }
  }
  window.VXOn(async (e, d) => {
    if (e === "checkout") {
      // A piece just won in a race (lib/race.js) is the one to keep held, whatever else is in the bag.
      const raced = window.VXRaceHold, pr = raced ? raced.id : d.pr, sz = raced ? raced.size : size(), res = await post("/api/hold", { productId: pr, size: sz, token: V.s }).catch(() => null);
      if (!res?.held) return;
      hold = { pr, sz, until: res.until, skew: res.now - Date.now() }; if (live) once("hold");
      const dlg = document.querySelector("dialog.co-dialog");
      dlg?.addEventListener("close", () => { clearInterval(clock); if (hold) post("/api/hold/release", { productId: hold.pr, size: hold.sz, token: V.s }).catch(() => {}); hold = null; }, { once: true });
      clearInterval(clock); if (live) { clock = setInterval(tick, 1000); tick(); }
    }
    if (e === "paid") {
      // the release: it's theirs, and it's still true that others wanted it
      clearInterval(clock); hold = null; document.querySelector("dialog[open] .vx-hold")?.remove();
      save("vx-r-seen", load("vx-r-seen", []).filter((x) => x.id !== d.pr)); // something you bought isn't one that got away
      const others = Math.max(0, seenToday - 1), dlg = document.querySelector("dialog.co-dialog[open]");
      if (live && on && dlg) setTimeout(() => { const el = document.createElement("div"); el.className = "vx-won"; el.textContent = others ? `It's yours. ${others} other ${others === 1 ? "person" : "people"} looked at this piece today, and you got it.` : "It's yours."; document.querySelector("dialog.co-dialog[open]")?.prepend(el); track("nudge", { x: "won" }); }, 500);
    }
  });

  // ---- the loss: a piece they looked at has really gone ----
  const when = (t) => { const d = Math.floor((Date.now() - t) / 864e5); return d < 1 ? "earlier today" : d === 1 ? "yesterday" : `${d} days ago`; };
  async function gone() {
    const seen = load("vx-r-seen", []), told = load("vx-r-told", []);
    if (!seen.length || document.querySelector(".vxi,.vx-hi,.vx-ask,.vx-sale,.vx-g")) return false;
    const list = await fetch("/api/products").then((r) => r.json()).catch(() => []);
    const lost = seen.find((x) => !told.includes(x.id) && list.find((p) => p.id === x.id)?.status === "sold");
    if (!lost) return true;
    save("vx-r-told", [...told, lost.id].slice(-30));
    once("gone"); if (!on) return true;
    const el = document.createElement("div");
    el.className = "vx-g float"; el.setAttribute("role", "status"); el.setAttribute("data-vx-skip", "");
    el.innerHTML = `<div><b>${esc(lost.name)} has gone.</b>You looked at it ${esc(when(lost.at))}, and someone else got it. Every piece here is a one-off. <a href="/#rack">See what's on the rack now</a></div><button type="button" aria-label="Close">×</button>`;
    el.querySelector("button").onclick = () => el.remove();
    document.body.append(el);
    return true;
  }
  if (path === "/") { let tries = 0; const t = setInterval(async () => { if (document.hidden) return; if (++tries < 8) return; if ((await gone()) || tries > 40) clearInterval(t); }, 1000); }
})();
