// The race for a last piece (server side: lib/races.js). Two real visitors on a piece with one left are each told the
// other is there, and both see the same 15 second clock. The first to press "Let me have it" gets a real hold, and
// the other is told so. Everything here is true: the clock takes nothing away, and when it ends the page says the
// piece is still there. The strip can be closed. The 15% of visitors who see no nudges (lib/rush.js) see none of this.
// A visitor with the piece in their bag, on any page of the site, is a real rival too: both are told, in words that
// say which it is. And a visitor alone on a last piece is told just that, with today's real count and no clock.
(() => {
  const V = window.VXVisit, track = window.VXTrack || (() => {}), R = window.SHOP?.rush || {};
  const pid = (/^\/p\/([\w-]{1,40})$/.exec(location.pathname) || [])[1];
  const B = window.VXBag;
  if (!V || R.race !== true || (!pid && !B)) return;
  const on = V.arm === "on", esc = (x) => String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let tid = pid || "", tname = ""; // the piece being raced: the page's own, or one from the bag
  const post = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
  const once = (x) => { const k = `vx-race-${x}-${tid}`; try { if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, "1"); } catch { /* private mode */ } track("nudge", { x, ...(on ? {} : { ctl: 1 }) }); };
  const css = document.createElement("style");
  css.textContent = `.vx-race{position:fixed;left:0;right:0;top:0;z-index:60;display:flex;align-items:center;gap:12px;padding:12px 12px 16px;padding-top:calc(12px + env(safe-area-inset-top,0px));background:var(--red,#e2382c);color:#fff;font:500 13.5px/1.35 var(--body,system-ui,sans-serif);box-shadow:0 2px 14px rgba(0,0,0,.25);animation:vxrace .25s ease-out}
.vx-race i{flex:none;width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:0 0 0 0 rgba(255,255,255,.7);animation:vxracedot 1s infinite}
.vx-race p{flex:1;min-width:0;margin:0}.vx-race p b{display:block;font-weight:700;font-size:14.5px}
.vx-race strong{flex:none;min-width:64px;text-align:center;font:800 46px/1 var(--mono,ui-monospace,monospace);font-variant-numeric:tabular-nums}.vx-race strong span{display:inline-block}.vx-race strong span.tick{animation:vxracetick .45s cubic-bezier(.2,1.6,.4,1)}
.vx-race strong small{display:block;margin-top:2px;font:600 10px/1 var(--body,system-ui,sans-serif);letter-spacing:.08em;text-transform:uppercase;opacity:.7}
.vx-race.calm{background:var(--ink,#111);padding-bottom:12px}.vx-race.calm i{background:#9a9a9a;animation:none}.vx-race.calm strong,.vx-race.calm u{display:none}
.vx-race u{position:absolute;left:0;bottom:0;height:5px;width:100%;background:#fff;transition:width .25s linear}
.vx-race.hot{animation:vxracehot .5s steps(2,jump-none) infinite}.vx-race.hot strong span{animation:vxraceshake .25s infinite}
.vx-race-edge{position:fixed;inset:0;z-index:59;pointer-events:none;box-shadow:inset 0 0 0 4px var(--red,#e2382c),inset 0 0 38px rgba(226,56,44,.45);animation:vxraceedge 1s ease-in-out infinite}
.pdp-info [data-order][data-race]{animation:vxracebtn .9s ease-in-out infinite}
.vx-race.go{flex-wrap:wrap}.vx-race.go p{flex:1 1 50%}.vx-race .vx-race-go{order:5;flex:1 0 100%;width:auto;height:auto;margin:0 0 2px;min-height:44px;padding:8px 14px;border-radius:99px;background:#fff;color:var(--ink,#111);font:700 14px/1 var(--body,system-ui,sans-serif);white-space:nowrap}
.vx-race button{flex:none;width:36px;height:36px;margin:-4px -6px -4px 0;padding:0;border:0;border-radius:50%;background:none;color:#fff;font:400 22px/1 system-ui,sans-serif;cursor:pointer}
.vx-race-chip{position:relative;z-index:1;margin-left:10px;padding:3px 10px;border-radius:99px;background:#fff;color:var(--red,#e2382c);font:800 15px/1.4 var(--mono,ui-monospace,monospace);font-variant-numeric:tabular-nums}
.vx-race-note{margin:10px 0 0;padding:12px;border:1px solid var(--line-2,#bbb);border-radius:8px;font:500 14px/1.4 var(--body,system-ui,sans-serif);color:var(--ink,#111)}
.vx-race-note b{display:block;margin-bottom:2px;font-weight:700}
.vx-race-note div{display:flex;gap:6px;margin-top:10px}
.vx-race-note input{flex:1;min-width:0;min-height:44px;padding:8px 10px;border:1px solid var(--line-2,#bbb);border-radius:6px;background:none;color:inherit;font:inherit}
.vx-race-note button{flex:none;min-height:44px;padding:8px 14px;border:0;border-radius:6px;background:var(--ink,#111);color:var(--paper,#fff);font:600 14px inherit;cursor:pointer}
.vx-race-note [role=status]{margin:6px 0 0;font-size:13px}
@keyframes vxrace{0%{transform:translateY(-100%)}60%{transform:translateY(6px)}80%{transform:translateY(-3px)}}
@keyframes vxracedot{70%{box-shadow:0 0 0 10px rgba(255,255,255,0)}100%{box-shadow:0 0 0 0 rgba(255,255,255,0)}}
@keyframes vxracetick{0%{transform:scale(1.7)}100%{transform:scale(1)}}
@keyframes vxracehot{0%{background:var(--red,#e2382c)}100%{background:#8f140c}}
@keyframes vxraceshake{0%,100%{transform:translateX(0)}25%{transform:translateX(-2px) rotate(-3deg)}75%{transform:translateX(2px) rotate(3deg)}}
@keyframes vxraceedge{50%{box-shadow:inset 0 0 0 7px var(--red,#e2382c),inset 0 0 70px rgba(226,56,44,.7)}}
@keyframes vxracebtn{0%,100%{transform:scale(1)}50%{transform:scale(1.045);box-shadow:0 0 0 6px rgba(226,56,44,.35),0 8px 24px rgba(226,56,44,.45)}}
@media (prefers-reduced-motion:reduce){.vx-race,.vx-race i,.vx-race.hot,.vx-race.hot strong span,.vx-race strong span.tick,.vx-race-edge,.pdp-info [data-order][data-race]{animation:none}}`;
  document.head.append(css);

  // idle -> race (clock running) -> over (nobody pressed) | lost (the other pressed) | won (this visitor pressed)
  let pulse = null, skew = 0, race = null, state = "idle", closed = false, overAt = 0, lostAt = 0, won = null, busy = false, timer = 0;
  let rivalIs = "page", solo = null; // who the rival is ("page": looking at it, "bag": has it in their bag); the alone note
  const opened = Date.now(), dead = new Set(); // bag pieces that are not a last piece need no asking
  const button = () => document.querySelector(".pdp-info [data-order]");
  // A red edge round the whole screen while the clock runs, and a buzz on phones that allow it. No sound.
  const edge = document.createElement("div"); edge.className = "vx-race-edge"; edge.setAttribute("aria-hidden", "true");
  const buzz = (pattern) => { try { navigator.vibrate?.(pattern); } catch { /* not allowed here */ } };
  // The seconds on the button itself, as a real element: the button's own ::after is its shine.
  const chip = (b, left) => {
    if (!b) return;
    let c = b.querySelector(".vx-race-chip");
    if (left == null) { c?.remove(); delete b.dataset.race; return; }
    if (!c) { c = document.createElement("b"); c.className = "vx-race-chip"; c.setAttribute("aria-hidden", "true"); b.append(c); }
    if (b.dataset.race !== String(left)) { b.dataset.race = left; c.textContent = `${left}s`; }
  };

  async function read() {
    clearTimeout(timer);
    timer = setTimeout(read, pulse?.last ? 3000 : 12000); // a last piece is asked about often, so both pages hear of a race in time
    if (document.hidden) return;
    if (!pid) return readBag();
    let p; try { p = await fetch(`/api/pulse?id=${encodeURIComponent(pid)}&s=${V.s}`, { cache: "no-store" }).then((r) => r.json()); } catch { return; }
    const first = !pulse; pulse = p;
    if (first && p.last) { clearTimeout(timer); timer = setTimeout(read, 3000); }
    take(p);
    if (state === "lost" && !p.heldByOther && p.status === "available") { state = "idle"; document.querySelector(".vx-race-note")?.remove(); } // they didn't finish: it's open again
    // Alone on a last piece: say so once, a moment after they arrive. No rival, so no clock.
    if (state === "idle" && !solo && on && p.last && p.status === "available" && !p.race && !p.watching && !p.inBags && !p.heldByOther && !p.mine && Date.now() - opened > 2500) {
      let seen = false; try { seen = Boolean(sessionStorage.getItem(`vx-race-solo-${pid}`)); sessionStorage.setItem(`vx-race-solo-${pid}`, "1"); } catch { /* private mode */ }
      solo = { at: seen ? 0 : Date.now(), others: Math.max(0, (p.today || 0) - 1) };
      if (!seen) { closed = false; track("nudge", { x: "race_solo" }); }
    }
    draw();
  }
  // What one answer from the server means for the race on the piece it is about.
  function take(p) {
    if (p.now) skew = p.now - Date.now();
    if (p.watching > 0) rivalIs = "page"; else if (p.inBags > 0) rivalIs = "bag";
    if (p.race && state !== "won" && state !== "lost") {
      const next = { from: p.race.from - skew, until: p.race.until - skew };
      if (Date.now() < next.until && (state !== "race" || Math.abs(next.until - race.until) > 1500)) { state = "race"; closed = false; once("race"); }
      if (state === "race") race = next;
    }
    if (p.heldByOther && (state === "race" || state === "over")) lose("beaten"); // pressed during the clock or just after it
  }
  // Off the product page: ask about the last pieces in this visitor's bag, which also tells the shop they are here with them.
  async function readBag() {
    const lines = [...new Map(B.bag().map((l) => [l.id, l])).values()].filter((l) => !dead.has(l.id)).slice(0, 4);
    clearTimeout(timer); timer = setTimeout(read, lines.length ? 4000 : 15000);
    if (document.querySelector("dialog.co-dialog[open]")) return; // they are ordering: nothing to add
    for (const l of lines) {
      let p; try { p = await fetch(`/api/pulse?id=${encodeURIComponent(l.id)}&s=${V.s}&bag=1`, { cache: "no-store" }).then((r) => r.json()); } catch { continue; }
      if (!p.last) { if (p.status !== "available" || !p.heldByOther) dead.add(l.id); continue; }
      if (state === "race" && l.id !== tid) continue; // one race at a time
      if (state !== "race" && !(p.race && p.race.until - (p.now - Date.now()) > Date.now())) continue;
      if (state !== "race") { tid = l.id; tname = p.name || "a piece"; if (state === "lost" || state === "over") state = "idle"; }
      pulse = p; take(p);
    }
    draw();
  }

  function strip(kind, html) {
    let el = document.querySelector(".vx-race");
    if (!on || closed || !html) { el?.remove(); return; }
    if (!el) {
      el = document.createElement("div"); el.setAttribute("role", "status"); el.setAttribute("data-vx-skip", "");
      el.addEventListener("click", (e) => {
        if (e.target.closest("[data-go]")) return go();
        if (e.target.closest("button")) { closed = true; el.remove(); track("nudge", { x: "race_closed" }); }
      });
      document.body.append(el);
    }
    if (el.dataset.kind !== kind) { el.dataset.kind = kind; el.className = `vx-race${kind.startsWith("run") ? "" : " calm"}${html.includes("data-go") ? " go" : ""}`; el.innerHTML = html; }
    return el;
  }
  const GO = `<button type="button" class="vx-race-go" data-go>Order now</button>`;
  function draw() {
    const t = Date.now(), b = button();
    if (state === "race" && t >= race.until) { state = "over"; overAt = t; once("race_over"); }
    if (state === "race") {
      const left = Math.max(1, Math.min(Math.ceil((race.until - race.from) / 1000), Math.ceil((race.until - t) / 1000))), running = t >= race.from;
      const head = pid
        ? (rivalIs === "bag" ? "Someone has this piece in their bag right now." : "Someone else is looking at this piece right now.")
        : (rivalIs === "bag" ? `Someone else has ${esc(tname)} in their bag too, right now.` : `Someone is looking at ${esc(tname)} from your bag right now.`);
      const el = strip(`run-${pid ? "p" : "b"}-${rivalIs}`, `<i aria-hidden="true"></i><p><b>${head}</b>There is only one. ${pid ? "First to tap <q>Let me have it</q> gets it." : "First to order gets it."}</p><strong aria-hidden="true"><span></span><small>seconds</small></strong>${pid ? "" : GO}<button type="button" aria-label="Close">×</button><u aria-hidden="true"></u>`);
      if (el) {
        // the number lands with a pop each second, the white bar under the strip drains, and the last five seconds flash
        const num = el.querySelector("strong span"), text = running ? String(left) : "…";
        if (num.textContent !== text) { num.textContent = text; num.classList.remove("tick"); void num.offsetWidth; num.classList.add("tick"); if (running && left <= 5) buzz(60); }
        el.querySelector("u").style.width = `${running ? Math.max(0, Math.min(100, ((race.until - t) / (race.until - race.from)) * 100)) : 100}%`;
        el.classList.toggle("hot", running && left <= 5);
        if (!edge.isConnected) { document.body.append(edge); buzz([120, 80, 120]); }
      } else edge.remove();
      chip(b, on && running ? left : null);
      return;
    }
    chip(b, null); edge.remove();
    if (state === "over" && t - overAt < 7000) return void strip("over", pid
      ? `<i aria-hidden="true"></i><p><b>Nobody took it. It is still here.</b>First to tap <q>Let me have it</q> gets it.</p><button type="button" aria-label="Close">×</button>`
      : `<i aria-hidden="true"></i><p><b>Nobody took it. ${esc(tname)} is still in your bag.</b>First to order gets it.</p>${GO}<button type="button" aria-label="Close">×</button>`);
    if (!pid && state === "lost" && t - lostAt < 9000) return void strip("lost", `<i aria-hidden="true"></i><p><b>Someone got there first.</b>${esc(tname)} is held for them for 10 minutes. If they do not finish their order, it is open again.</p><button type="button" aria-label="Close">×</button>`);
    if (state === "idle" && solo?.at && t - solo.at < 9000) return void strip("solo", `<i aria-hidden="true"></i><p><b>Only one of these exists.</b>${solo.others ? `${solo.others} other ${solo.others === 1 ? "person has" : "people have"} looked at it today. ` : ""}First to tap <q>Let me have it</q> gets it.</p><button type="button" aria-label="Close">×</button>`);
    strip("", "");
    if (state === "won" && on && R.live !== true) holdBox(); // lib/rush.js draws this box itself when its live notes are on
  }

  // The winner's proof: the hold and its real time left, on top of the checkout.
  function holdBox() {
    const dlg = document.querySelector("dialog.co-dialog[open]");
    if (!dlg || !won) return;
    const left = won.until - Date.now(), box = dlg.querySelector(".vx-hold");
    if (left <= 0) { box?.remove(); won = null; window.VXRaceHold = null; return; }
    const m = Math.floor(left / 60e3), s = String(Math.floor(left / 1000) % 60).padStart(2, "0");
    if (box) box.querySelector("b").textContent = `${m}:${s}`;
    else { const el = document.createElement("div"); el.className = "vx-hold"; el.setAttribute("role", "timer"); el.innerHTML = `<span>You got it first. It is held for you, and nobody else can order it.</span><b>${m}:${s}</b>`; dlg.prepend(el); }
  }

  // The other visitor pressed first. Say so, and offer the one useful thing: a message if it comes back.
  function lose(how) {
    state = "lost"; lostAt = Date.now(); strip("", ""); track("nudge", { x: `race_lost_${how}` });
    const at = pid && document.querySelector(".pdp-price");
    if (!on || !at || document.querySelector(".vx-race-note")) return;
    const el = document.createElement("div");
    el.className = "vx-race-note"; el.setAttribute("data-vx-skip", "");
    el.innerHTML = `<b>Someone got there first.</b>It is held for them for 10 minutes. If they do not finish their order, it is open again. Leave your WhatsApp number and we will tell you if it comes back. We will only use it for this.<div><input type="tel" inputmode="numeric" maxlength="14" placeholder="98765 43210" aria-label="Your WhatsApp number"><button type="button">Tell me</button></div><p role="status"></p>`;
    el.querySelector("button").onclick = async () => {
      const r = await post("/api/next-in-line", { productId: pid, phone: el.querySelector("input").value }).catch(() => ({ error: "Please try again." }));
      if (r.ok) { el.innerHTML = "<b>You are in line.</b>We will message you on WhatsApp if it comes back."; track("nudge", { x: "next_in_line" }); } else el.querySelector("[role=status]").textContent = r.error;
    };
    at.after(el);
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  // "Let me have it" while someone else is on the same last piece: the press takes the hold first, so the order of
  // the two presses is decided by the server and nowhere else. Alone on a piece, the button works as it always has.
  const win = (res, size) => { window.VXRaceHold = { id: tid, size: size || "" }; state = "won"; won = { until: res.until - (res.now - Date.now()) }; track("nudge", { x: "race_won" }); draw(); B.checkout(); }; // straight to the order: the hold is running
  // The same press from the strip, for the piece in their bag.
  function go() {
    if (busy || !B) return;
    busy = true;
    const line = B.bag().find((l) => l.id === tid);
    post("/api/hold", { productId: tid, size: line?.size || "", token: V.s }).catch(() => null).then((res) => {
      busy = false;
      if (res?.taken) { lose("late"); return draw(); }
      if (res?.held) return win(res, line?.size);
      strip("", ""); state = "idle"; B.checkout();
    });
  }
  if (B && on && pid) {
    const add = B.add;
    B.add = (p, from) => {
      const rival = state === "race" || state === "over" || state === "lost" || pulse?.watching > 0 || pulse?.inBags > 0 || pulse?.heldByOther;
      if (p.id !== pid || !pulse?.last || !rival) return add(p, from);
      if (busy) return;
      busy = true;
      post("/api/hold", { productId: pid, size: p.chosenSize || "", token: V.s }).catch(() => null).then((res) => {
        busy = false;
        if (res?.taken) return lose("late");
        add(p, from);
        if (res?.held) win(res, p.chosenSize);
      });
    };
  }

  read(); setInterval(draw, 250);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) read(); });
})();
