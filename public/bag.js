// The bag, the wishlist and signing in. Loaded on every shop page after order.js and checkout.js.
// Signed out, the bag lives in this browser. Signed in, it lives in the account, so it follows the
// customer to any phone. Buying needs an account (the shop's choice): Checkout asks them to sign in
// with WhatsApp (free: they send us a code from their own number) or Google.
window.VXBag = (() => {
  const S = window.SHOP, A = S.accounts || {};
  const O = () => window.VXOrder;
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  // Google refuses to sign in inside app browsers (Instagram, Facebook, WhatsApp...). Show it only where it works.
  const inApp = /FBAN|FBAV|FB_IAB|FBIOS|Instagram|Line\/|WhatsApp|Snapchat|; wv\)/i.test(navigator.userAgent);
  const BAG_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 7h12l1 14H5L6 7z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>`;
  const USER_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>`;
  const WA_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg>`;

  let me = { signedIn: false }, bag = store.get("vx-bag") || [], wish = store.get("vx-wish") || [];
  const ready = fetch("/api/account/me", { cache: "no-store" }).then((r) => r.json()).then((m) => { if (m.signedIn) adopt(m); return me; }).catch(() => me).finally(paint);
  const products = () => window.VXProducts || [];

  function adopt(m) {
    me = m;
    bag = m.bag || [];
    wish = m.wish || [];
    store.set("vx-bag", []); store.set("vx-wish", []); // the account holds them now
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
    document.querySelectorAll("[data-wish]").forEach((b) => { const on = wish.includes(b.dataset.wish); b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); b.setAttribute("aria-label", on ? "Saved to wishlist" : "Save to wishlist"); });
    document.dispatchEvent(new CustomEvent("vx-bag"));
  }

  // ---------- adding ----------
  function add(p) {
    const size = p.chosenSize || "";
    const have = bag.find((l) => l.id === p.id && (l.size || "") === size);
    if (!have) bag.push({ id: p.id, size, qty: 1 });
    save();
    window.VXTrack?.("bag_add", { pr: p.id, n: p.price });
    openSheet({ added: p });
  }
  function remove(id, size = "") { bag = bag.filter((l) => !(l.id === id && (l.size || "") === size)); save(); }
  function toggleWish(id) {
    wish = wish.includes(id) ? wish.filter((x) => x !== id) : [...wish, id];
    save();
    window.VXTrack?.("wish", { pr: id, x: wish.includes(id) ? "on" : "off" });
    if (wish.includes(id)) O().toast(`<b>Saved</b><span>In your wishlist${me.signedIn ? "" : ". Sign in to keep it on every phone"}.</span><a class="toast-go" href="/account#wish">View</a>`);
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
    dlg.addEventListener("close", () => { stopWait(); });
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
      <button type="button" class="order co-cta" data-checkout>${me.signedIn ? "Checkout" : "Sign in to checkout"} · ${rupees(q.goods)}</button>` : ""}
      ${off.length ? `<p class="co-small">Pieces marked in grey can't be ordered right now. Remove them to continue.</p>` : ""}
      <button type="button" class="co-back" data-close>Keep shopping</button></div>`;
    if (added) window.VXTrack?.("bag_view", { n: q.goods });
  }

  async function checkout() {
    const q = await quote();
    if (q.problems?.length) return openSheet();
    if (!q.lines.length) return openSheet();
    window.VXTrack?.("bag_checkout", { n: q.goods });
    if (!me.signedIn) { const ok = await signIn("Sign in to order"); if (!ok) return; }
    dlg?.close();
    window.VXCheckout.openBag(q, me);
  }

  // ---------- signing in ----------
  let wait = null;
  function stopWait() { clearInterval(wait); wait = null; document.removeEventListener("visibilitychange", onBack); }
  let checkNow = null;
  function onBack() { if (document.visibilityState === "visible") checkNow?.(); }

  // Resolves true once signed in, false if they close the box.
  function signIn(title = "Sign in") {
    return new Promise(async (resolve) => {
      const d = dialog(), { esc } = O();
      if (!d.open) d.showModal();
      let done = false;
      const finish = (m) => { if (done) return; done = true; stopWait(); if (m) { adopt(m); paint(); window.VXTrack?.("signin", { x: m.via }); } resolve(Boolean(m)); };
      d.addEventListener("close", () => finish(null), { once: true });
      const google = A.google && !inApp;
      d.innerHTML = `<div class="co vx-sign"><button type="button" class="ask-x" data-close aria-label="Close">×</button>
        <h2>${esc(title)}</h2>
        <p class="co-small">One tap, no password. Your bag, orders, saved address and coins stay with you on any phone.</p>
        ${A.whatsapp ? `<a class="btn vx-wa" data-wa href="#" aria-disabled="true">${WA_SVG}<span>Verify on WhatsApp</span></a>
        <p class="co-small vx-wa-how">WhatsApp opens with a message ready. Just press <b>Send</b>, then come back here.</p>` : ""}
        ${google ? `<div class="vx-or"><span>or</span></div><div class="vx-google" id="vx-google"></div>` : ""}
        ${A.google && inApp ? `<p class="co-small vx-inapp">Google sign-in only works in Chrome or Safari. WhatsApp works right here.</p>` : ""}
        <p class="ask-err" role="alert" hidden></p>
        <p class="consent">We keep your name, number or email, address and orders to run your account. <a href="/privacy" target="_blank" rel="noopener">Privacy policy</a></p></div>`;
      const err = (t) => { const e = d.querySelector(".ask-err"); e.textContent = t; e.hidden = !t; };
      if (!A.whatsapp && !google) err("Sign-in isn't available right now. Message us on WhatsApp to order.");

      // WhatsApp: the code is fetched first, so tapping the button is a plain link the app can open.
      if (A.whatsapp) {
        const a = d.querySelector("[data-wa]");
        a.addEventListener("click", (e) => { if (a.getAttribute("aria-disabled") === "true") e.preventDefault(); else { window.VXTrack?.("signin_wa"); d.querySelector(".vx-wa-how").innerHTML = "Waiting for your WhatsApp message… <b>Press Send</b> in WhatsApp, then come back."; } });
        let st;
        try {
          st = await fetch("/api/account/wa/start", { method: "POST" }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; });
          a.href = st.link; a.target = "_blank"; a.rel = "noopener"; a.removeAttribute("aria-disabled");
          a.dataset.code = st.code;
        } catch (ex) { err(ex.message || "WhatsApp sign-in isn't available right now."); }
        if (st) {
          checkNow = async () => {
            if (done) return;
            const r = await fetch("/api/account/wa/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pending: st.pending, bag, wish }) }).then((x) => x.json()).catch(() => ({ waiting: true }));
            if (r.signedIn) finish(r);
            else if (r.expired) { stopWait(); err("That code ran out. Close this and try again."); }
          };
          wait = setInterval(checkNow, 2000);
          document.addEventListener("visibilitychange", onBack);
        }
      }
      if (google) {
        loadGoogle().then(() => {
          window.google.accounts.id.initialize({
            client_id: A.google, ux_mode: "popup",
            callback: async ({ credential }) => {
              const r = await fetch("/api/account/google", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential, bag, wish }) }).then(async (x) => ({ ok: x.ok, j: await x.json() })).catch(() => ({ ok: false, j: {} }));
              if (r.ok && r.j.signedIn) finish(r.j); else err(r.j.error || "Google sign-in failed. Please try again.");
            },
          });
          const el = d.querySelector("#vx-google");
          if (el) window.google.accounts.id.renderButton(el, { theme: "outline", size: "large", shape: "pill", text: "continue_with", width: Math.min(360, el.clientWidth || 320) });
        }).catch(() => { const el = d.querySelector("#vx-google"); if (el) el.innerHTML = `<p class="co-small">Google sign-in didn't load. Use WhatsApp instead.</p>`; });
      }
    });
  }
  let gLoad = null;
  function loadGoogle() {
    return gLoad ||= new Promise((ok, bad) => {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client"; s.async = true; s.onload = ok; s.onerror = () => { gLoad = null; bad(); };
      document.head.appendChild(s);
    });
  }
  async function signOut() {
    await fetch("/api/account/logout", { method: "POST" }).catch(() => {});
    me = { signedIn: false }; bag = []; wish = [];
    save();
  }
  // After an order is confirmed, the pieces it bought leave the bag.
  function ordered(lines) {
    bag = bag.filter((b) => !lines.some((l) => (l.productId || l.id) === b.id && (l.size || "") === (b.size || "")));
    save();
  }

  document.addEventListener("click", (e) => {
    const w = e.target.closest("[data-wish]");
    if (w) { e.preventDefault(); return toggleWish(w.dataset.wish); }
    const b = e.target.closest("[data-bag-open]");
    if (b && location.pathname !== "/bag") { e.preventDefault(); openSheet(); }
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", paint); else paint();

  return { add, remove, openSheet, checkout, signIn, signOut, ordered, toggleWish, quote, ready, me: () => me, bag: () => bag, wish: () => wish, inApp };
})();
