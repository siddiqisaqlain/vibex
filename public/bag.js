// The bag and the wishlist. Loaded on every shop page after order.js and checkout.js.
// No sign-in (2026-11-09): before a phone's first order, the bag and wishlist live in this browser.
// The first order quietly makes the phone's account (a cookie), and from then on they live there,
// next to its orders, saved address and coins.
window.VXBag = (() => {
  const S = window.SHOP, A = S.accounts || {};
  const O = () => window.VXOrder;
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  const BAG_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 7h12l1 14H5L6 7z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>`;
  const USER_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>`;

  let me = { signedIn: false }, bag = store.get("vx-bag") || [], wish = store.get("vx-wish") || [];
  const ready = fetch("/api/account/me", { cache: "no-store" }).then((r) => r.json()).then((m) => { if (m.signedIn) adopt(m); return me; }).catch(() => me).finally(paint);
  const products = () => window.VXProducts || [];

  // The phone's account is there (it ordered before): what this browser still holds joins it.
  function adopt(m) {
    me = m;
    const key = (l) => `${l.id}|${l.size || ""}`, local = bag.length + wish.length;
    bag = [...(m.bag || []), ...bag.filter((l) => !(m.bag || []).some((x) => key(x) === key(l)))];
    wish = [...new Set([...(m.wish || []), ...wish])];
    store.set("vx-bag", []); store.set("vx-wish", []); // the account holds them now
    if (local) save();
    if (m.name) O()?.rememberName?.(m.name);
  }
  function save() {
    if (me.signedIn) {
      fetch("/api/account/bag", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bag }) }).catch(() => {});
      fetch("/api/account/wish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wish }) }).catch(() => {});
    } else { store.set("vx-bag", bag); store.set("vx-wish", wish); }
    paint();
  }
  const count = () => bag.reduce((n, l) => n + (l.qty || 1), 0);

  // ---------- header: bag with a count, and the account ----------
  function header() {
    if (document.querySelector(".vx-hdr")) return;
    const box = document.createElement("div");
    box.className = "vx-hdr";
    box.innerHTML = `<a class="vx-hbtn" href="/account" aria-label="My account">${USER_SVG}</a>
      <a class="vx-hbtn" href="/bag" data-bag-open aria-label="My bag">${BAG_SVG}<span class="vx-count" hidden></span></a>`;
    const icons = document.querySelector("header .icons"), menu = document.querySelector("header .menu-btn");
    if (icons) icons.appendChild(box);
    else if (menu) menu.parentNode.insertBefore(box, menu);
    else document.querySelector("header .top-row, header nav")?.appendChild(box); // product and account pages
  }
  function paint() {
    header();
    const n = count();
    document.querySelectorAll(".vx-count").forEach((el) => { el.textContent = n; el.hidden = !n; });
    document.querySelectorAll("[data-quick]").forEach((b) => { const on = bag.some((l) => l.id === b.dataset.quick); if (b.classList.contains("in") !== on) { b.classList.toggle("in", on); b.setAttribute("aria-label", b.getAttribute("aria-label").replace(/^[^:]+:/, on ? "In your bag:" : "Add to bag:")); } });
    document.querySelectorAll("[data-wish]").forEach((b) => { const on = wish.includes(b.dataset.wish); b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); b.setAttribute("aria-label", on ? "Saved to wishlist" : "Save to wishlist"); });
    document.dispatchEvent(new CustomEvent("vx-bag"));
  }

  // ---------- adding ----------
  function add(p, from) {
    const size = p.chosenSize || "";
    const have = bag.find((l) => l.id === p.id && (l.size || "") === size);
    if (!have) bag.push({ id: p.id, size, qty: 1 });
    save();
    window.VXTrack?.("bag_add", { pr: p.id, n: p.price, x: from === "rack" ? "rack" : "page" });
    if (!have) fly(p);
    addedBar(p, Boolean(have));
  }
  // The piece's photo flies up into the bag in the header, and the bag answers with a bump:
  // it shows the tap worked and where the bag is. Off for reduced motion.
  const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  function fly(p) {
    const to = [...document.querySelectorAll("[data-bag-open]")].find((el) => el.getClientRects().length);
    const bump = () => { if (!to) return; to.classList.remove("bump"); void to.offsetWidth; to.classList.add("bump"); };
    const from = document.querySelector(`.card[data-id="${CSS.escape(p.id)}"] .media img`) || document.querySelector(".pdp-media img");
    if (calm() || !to || !from || !from.animate) return bump();
    const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
    if (a.bottom < 0 || a.top > innerHeight) return bump();
    const w = Math.min(a.width, 150), h = w * (a.height / a.width), x0 = a.left + (a.width - w) / 2, y0 = Math.max(a.top + (a.height - h) / 2, 70);
    const ghost = document.createElement("img");
    ghost.src = from.currentSrc || from.src; ghost.alt = ""; ghost.className = "vx-fly";
    ghost.style.cssText = `left:${x0}px;top:${y0}px;width:${w}px;height:${h}px`;
    document.body.appendChild(ghost);
    const dx = b.left + b.width / 2 - (x0 + w / 2), dy = b.top + b.height / 2 - (y0 + h / 2);
    ghost.animate([
      { transform: "translate(0,0) scale(1)", opacity: 1, borderRadius: "10px" },
      { transform: `translate(${dx * 0.35}px, ${dy * 0.55 - 40}px) scale(.62) rotate(-6deg)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${dx}px, ${dy}px) scale(.12) rotate(0deg)`, opacity: 0.35, borderRadius: "50%" },
    ], { duration: 720, easing: "cubic-bezier(.3,.1,.2,1)" }).onfinish = () => { ghost.remove(); bump(); };
  }
  // The first time the rack is seen, the first bag button rings twice so people learn it is there.
  function hintQuick() {
    const rack = document.getElementById("grid");
    if (!rack || calm() || !window.IntersectionObserver || store.get("vx-quick-seen")) return;
    const io = new IntersectionObserver((list) => {
      if (!list.some((e) => e.isIntersecting)) return;
      const b = [...rack.querySelectorAll(".vx-quick:not(.in)")].find((el) => { const r = el.getBoundingClientRect(); return r.top > 80 && r.bottom < innerHeight - 90; });
      if (!b) return;
      io.disconnect(); store.set("vx-quick-seen", 1);
      setTimeout(() => { b.classList.add("hint"); setTimeout(() => b.classList.remove("hint"), 3200); }, 700);
    }, { threshold: [0, 0.2, 0.5] });
    io.observe(rack);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hintQuick); else setTimeout(hintQuick, 0);
  // After adding: a slim bar at the bottom, not the whole bag over the page (2026-11-11). They stay where they
  // were and can keep adding; Checkout is one tap away, and a tap on the words opens the bag.
  let bar = null, barTimer = null;
  function addedBar(p, had) {
    const { esc, rupees } = O();
    if (!bar) {
      bar = document.createElement("div");
      bar.className = `vx-addbar${document.querySelector(".pdp") ? " on-pdp" : ""}`; bar.setAttribute("role", "status");
      document.body.appendChild(bar);
      bar.addEventListener("click", (e) => {
        if (e.target.closest("[data-checkout]")) { hideBar(); return checkout(); }
        if (e.target.closest("[data-bar-x]")) return hideBar();
        if (e.target.closest("[data-bar-bag]")) { hideBar(); openSheet(); }
      });
      bar.addEventListener("pointerenter", () => clearTimeout(barTimer));
      bar.addEventListener("pointerleave", () => { barTimer = setTimeout(hideBar, 4000); });
    }
    const n = count(), pic = p.image ? `<img src="${esc(p.image)}" alt="">` : "";
    bar.innerHTML = `<button type="button" class="vx-addbar-txt" data-bar-bag><span class="vx-addbar-pic">${pic}</span><span><b>✓ ${had ? "Already in your bag" : "Added to bag"}</b><small>${esc(p.name)}${p.chosenSize ? ` · ${esc(p.chosenSize)}` : ""} · ${n} in bag</small></span></button>
      <button type="button" class="vx-addbar-go" data-checkout>Checkout<span data-bar-total></span></button>
      <button type="button" class="vx-addbar-x" data-bar-x aria-label="Close">×</button>`;
    bar.hidden = false;
    bar.classList.remove("run"); void bar.offsetWidth; bar.classList.add("run"); // the line that shows how long it stays
    requestAnimationFrame(() => bar.classList.add("on"));
    clearTimeout(barTimer); barTimer = setTimeout(hideBar, 7000);
    const mine = bar.firstElementChild;
    quote().then((q) => { const el = bar.querySelector("[data-bar-total]"); if (el && bar.firstElementChild === mine && q.goods) el.textContent = ` · ${rupees(q.goods)}`; });
  }
  function hideBar() { clearTimeout(barTimer); if (!bar) return; bar.classList.remove("on"); setTimeout(() => { if (!bar.classList.contains("on")) bar.hidden = true; }, 260); }
  function remove(id, size = "") { bag = bag.filter((l) => !(l.id === id && (l.size || "") === size)); save(); }
  function toggleWish(id) {
    wish = wish.includes(id) ? wish.filter((x) => x !== id) : [...wish, id];
    save();
    window.VXTrack?.("wish", { pr: id, x: wish.includes(id) ? "on" : "off" });
    if (wish.includes(id)) O().toast(`<b>Saved</b><span>In your wishlist.</span><a class="toast-go" href="/account#wish">View</a>`);
  }

  // ---------- the bag sheet ----------
  let dlg = null;
  function dialog() {
    if (dlg) return dlg;
    dlg = document.createElement("dialog");
    dlg.className = "ask-dialog vx-sheet";
    document.body.appendChild(dlg);
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg || e.target.closest("[data-close]")) return dlg.close();
      const rm = e.target.closest("[data-rm]");
      if (rm) { remove(rm.dataset.rm, rm.dataset.size || ""); return openSheet(); }
      if (e.target.closest("[data-checkout]")) return checkout();
    });
    return dlg;
  }
  async function quote(extra = {}) {
    return fetch("/api/account/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines: bag, holdToken: window.VXVisit?.s, ...extra }) })
      .then((r) => r.json()).catch(() => ({ lines: [], goods: 0, problems: [] }));
  }
  function lineRow(l, problem) {
    const { esc, rupees, hash } = O();
    const p = products().find((x) => x.id === (l.productId || l.id)) || { id: l.productId || l.id, name: l.productName || "Piece" };
    const pic = (l.image || p.image) ? `<img src="${esc(l.image || p.image)}" alt="">` : window.productArt?.(p, hash(p.id)) || "";
    return `<li class="vx-line${problem ? " is-off" : ""}"><a class="vx-thumb" href="/p/${encodeURIComponent(p.id)}">${pic}</a>
      <div class="vx-line-txt"><b>${esc(l.productName || p.name)}</b><span class="mono">${l.size ? `${esc(l.size)} · ` : ""}${l.price ? rupees(l.price * (l.qty || 1)) : ""}${l.qty > 1 ? ` · ${l.qty} pcs` : ""}</span>${problem ? `<em>${esc(problem.text)}</em>` : ""}</div>
      <button type="button" class="vx-rm" data-rm="${esc(p.id)}" data-size="${esc(l.size || "")}" aria-label="Remove ${esc(l.productName || p.name)}">Remove</button></li>`;
  }
  async function openSheet({ added } = {}) {
    const d = dialog(), { esc, rupees } = O();
    if (!d.open) d.showModal();
    if (!bag.length) {
      d.innerHTML = `<div class="co vx-bag"><button type="button" class="ask-x" data-close aria-label="Close">×</button><h2>Your bag is empty</h2><p class="co-small">Tap <b>Add to bag</b> on anything you like.</p><button type="button" class="btn btn-ink" data-close>Keep shopping</button></div>`;
      return;
    }
    d.innerHTML = `<div class="co vx-bag"><button type="button" class="ask-x" data-close aria-label="Close">×</button>${added ? `<p class="vx-added">✓ Added to your bag</p>` : ""}<h2>Your bag</h2><p class="co-small">Loading…</p></div>`;
    const q = await quote();
    if (!d.open) return;
    const off = q.problems || [];
    const rows = [...q.lines.map((l) => lineRow(l)), ...off.map((x) => lineRow({ id: x.id, size: x.size, productName: x.name }, x))].join("");
    const earn = Math.floor(q.goods / ((A.coins?.perRupees) || 100));
    d.innerHTML = `<div class="co vx-bag"><button type="button" class="ask-x" data-close aria-label="Close">×</button>
      ${added ? `<p class="vx-added">✓ Added to your bag</p>` : ""}
      <h2>Your bag <span class="mono">${count()}</span></h2>
      <ul class="vx-lines">${rows}</ul>
      ${q.lines.length ? `<div class="vx-total"><span>Total</span><b>${rupees(q.goods)}</b></div>
      ${earn ? `<p class="co-small vx-earn">🪙 You'll earn <b>${earn} coin${earn === 1 ? "" : "s"}</b> with this order.</p>` : ""}
      <button type="button" class="order co-cta" data-checkout>Checkout · ${rupees(q.goods)}</button>` : ""}
      ${off.length ? `<p class="co-small">Pieces marked in grey can't be ordered right now. Remove them to continue.</p>` : ""}
      <button type="button" class="co-back" data-close>Keep shopping</button></div>`;
    window.VXTrack?.("bag_view", { n: q.goods });
  }

  async function checkout() {
    const q = await quote();
    if (q.problems?.length) return openSheet();
    if (!q.lines.length) return openSheet();
    window.VXTrack?.("bag_checkout", { n: q.goods });
    dlg?.close();
    window.VXCheckout.openBag(q, me);
  }

  // After an order is confirmed, the pieces it bought leave the bag.
  // The first order made this phone's account just now: pick it up, so the rest of the bag moves into it.
  async function ordered(lines) {
    bag = bag.filter((b) => !lines.some((l) => (l.productId || l.id) === b.id && (l.size || "") === (b.size || "")));
    if (!me.signedIn) {
      store.set("vx-bag", bag);
      const m = await fetch("/api/account/me", { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
      if (m.signedIn) { adopt(m); return paint(); }
    }
    save();
  }

  document.addEventListener("click", (e) => {
    const w = e.target.closest("[data-wish]");
    if (w) { e.preventDefault(); return toggleWish(w.dataset.wish); }
    const b = e.target.closest("[data-bag-open]");
    if (b && location.pathname !== "/bag") { e.preventDefault(); openSheet(); }
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", paint); else paint();

  return { add, remove, openSheet, checkout, ordered, toggleWish, quote, ready, me: () => me, bag: () => bag, wish: () => wish };
})();
