// /account and /bag: the customer's own pages. Drawn from /api/account/me and the shop's products.
(() => {
  const root = document.getElementById("acct");
  if (!root) return;
  const view = root.dataset.view;
  const O = window.VXOrder, B = window.VXBag;
  const { esc, rupees, hash } = O;
  let products = [];
  const STATUS = {
    awaiting_payment: ["Waiting for payment check", ""], paid: ["Payment being checked", ""], confirmed: ["Confirmed", "ok"],
    cancelled: ["Cancelled", "bad"], lapsed: ["Payment not confirmed", "bad"],
  };
  const thumb = (img, id, name) => img ? `<img src="${esc(img)}" alt="">` : window.productArt?.({ id, name }, hash(id)) || "";

  async function load() {
    const [me] = await Promise.all([B.ready, fetch("/api/products").then((r) => r.json()).then((p) => { products = p; window.VXProducts = p; }).catch(() => {})]);
    return me;
  }

  // ---------- /bag ----------
  async function drawBag() {
    const q = await B.quote();
    const off = q.problems || [];
    if (!q.lines.length && !off.length) {
      root.innerHTML = `<h1 class="acct-h">Your bag</h1><p class="acct-empty">Nothing here yet.</p><a class="btn btn-ink" href="/#rack">Shop new drops</a>`;
      return;
    }
    const row = (l, x) => `<li class="vx-line${x ? " is-off" : ""}"><a class="vx-thumb" href="/p/${encodeURIComponent(l.productId || l.id)}">${thumb(l.image || products.find((p) => p.id === (l.productId || l.id))?.image, l.productId || l.id, l.productName)}</a>
      <div class="vx-line-txt"><b>${esc(l.productName || x?.name || "Piece")}</b><span class="mono">${l.size ? `${esc(l.size)} · ` : ""}${l.price ? rupees(l.price * (l.qty || 1)) : ""}</span>${x ? `<em>${esc(x.text)}</em>` : ""}</div>
      <button type="button" class="vx-rm" data-rm-page="${esc(l.productId || l.id)}" data-size="${esc(l.size || "")}">Remove</button></li>`;
    const earn = Math.floor(q.goods / (window.SHOP.accounts?.coins?.perRupees || 100));
    root.innerHTML = `<h1 class="acct-h">Your bag <span class="mono">${q.lines.length + off.length}</span></h1>
      <div class="acct-bag"><ul class="vx-lines">${q.lines.map((l) => row(l)).join("")}${off.map((x) => row({ id: x.id, size: x.size, productName: x.name }, x)).join("")}</ul>
      <aside class="acct-sum"><div class="vx-total"><span>Total</span><b>${rupees(q.goods)}</b></div>
      ${earn ? `<p class="co-small vx-earn">🪙 You'll earn <b>${earn} coin${earn === 1 ? "" : "s"}</b> with this order.</p>` : ""}
      ${off.length ? `<p class="co-small">Remove the pieces in grey to continue.</p>` : ""}
      <button type="button" class="order co-cta" data-checkout-page ${q.lines.length && !off.length ? "" : "disabled"}>${B.me().signedIn ? "Checkout" : "Sign in to checkout"} · ${rupees(q.goods)}</button>
      <a class="co-back" href="/#rack">Keep shopping</a></aside></div>`;
  }

  // ---------- /account ----------
  function drawSignedOut() {
    root.innerHTML = `<h1 class="acct-h">My account</h1>
      <div class="acct-card acct-signin"><p>Sign in to see your orders, saved address, wishlist and coins on any phone.</p>
      <button type="button" class="btn btn-ink" data-signin>Sign in</button></div>
      ${B.wish().length ? `<section class="acct-sec" id="wish"><h2>Saved on this phone</h2>${wishGrid(B.wish())}</section>` : ""}`;
  }
  function wishGrid(ids) {
    const list = ids.map((id) => products.find((p) => p.id === id)).filter(Boolean);
    if (!list.length) return `<p class="acct-empty">Tap the heart on any piece to save it here.</p>`;
    return `<ul class="acct-wish">${list.map((p) => `<li><a href="/p/${encodeURIComponent(p.id)}" class="vx-thumb">${thumb(p.image, p.id, p.name)}</a>
      <a href="/p/${encodeURIComponent(p.id)}" class="acct-wname">${esc(p.name)}</a><span class="mono">${p.status === "sold" ? "Sold out" : p.price ? rupees(p.price) : "Ask"}</span>
      <button type="button" class="vx-rm" data-wish="${esc(p.id)}">Remove</button></li>`).join("")}</ul>`;
  }
  async function drawAccount() {
    const me = B.me();
    if (!me.signedIn) return drawSignedOut();
    const fresh = await fetch("/api/account/me", { cache: "no-store" }).then((r) => r.json()).catch(() => me);
    const c = fresh.coins || { balance: 0 }, a = fresh.address || {};
    const orders = fresh.orders || [];
    root.innerHTML = `<h1 class="acct-h">Hi${fresh.name ? ` ${esc(O.firstName(fresh.name) || fresh.name)}` : ""}</h1>
      <p class="acct-who mono">${esc(fresh.phone ? `+91 ${fresh.phone.slice(0, 5)} ${fresh.phone.slice(5)}` : fresh.email || "")}</p>
      <div class="acct-card acct-coins"><span class="acct-coin" aria-hidden="true">🪙</span><div><b>${c.balance} coin${c.balance === 1 ? "" : "s"}</b>
        <p>You earn 1 coin for every ${rupees(c.perRupees || 100)} you spend, once Vibe X confirms your payment. 1 coin = ₹1. ${c.redeemOn ? `Spend them at checkout, up to ${c.maxPct}% of a bag.` : "You'll be able to spend them when Vibe X opens coin offers."}</p></div></div>
      <section class="acct-sec"><h2>My orders</h2>${orders.length ? `<ul class="acct-orders">${orders.map((o) => {
        const s = STATUS[o.status] || [o.status, ""];
        return `<li><div class="acct-otop"><b class="mono">${esc(o.code)}</b><span class="acct-pill ${s[1]}">${s[0]}</span><span class="mono">${new Date(o.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span></div>
          <div class="acct-olines">${o.lines.map((l) => `<a href="/p/${encodeURIComponent(l.productId)}" class="acct-oline"><span class="vx-thumb">${thumb(l.image, l.productId, l.name)}</span><span>${esc(l.name)}${l.size ? ` · ${esc(l.size)}` : ""}</span></a>`).join("")}</div>
          <p class="mono acct-oamt">${rupees(o.amount)}${o.coinsUsed ? ` · ${o.coinsUsed} coins used` : ""} · ${o.delivery === "ship" ? "Delivery" : "Pickup"}</p></li>`;
      }).join("")}</ul>` : `<p class="acct-empty">No orders yet.</p>`}</section>
      <section class="acct-sec" id="wish"><h2>Wishlist</h2>${wishGrid(fresh.wish || [])}</section>
      <section class="acct-sec"><h2>Saved address</h2>
        <form class="co-form acct-addr" novalidate>
          <label>Name<input name="name" autocomplete="name" maxlength="60" value="${esc(a.name || fresh.name || "")}"></label>
          <label>WhatsApp number<div class="ask-phone"><span>+91</span><input name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" maxlength="14" value="${esc(a.phone || fresh.phone || "")}"></div></label>
          <label>Address<input name="address" autocomplete="street-address" maxlength="300" value="${esc(a.address || "")}"></label>
          <div class="co-row"><label>City<input name="city" autocomplete="address-level2" maxlength="60" value="${esc(a.city || "")}"></label>
          <label>PIN code<input name="pin" inputmode="numeric" autocomplete="postal-code" maxlength="6" value="${esc(a.pin || "")}"></label></div>
          <input type="hidden" name="delivery" value="${a.delivery === "pickup" ? "pickup" : "ship"}">
          <button class="btn btn-line" type="submit">Save address</button><p class="co-small acct-saved" role="status" hidden>Saved.</p>
        </form></section>
      <button type="button" class="co-back acct-out" data-signout>Sign out</button>`;
    root.querySelector(".acct-addr").addEventListener("submit", async (e) => {
      e.preventDefault();
      await fetch("/api/account/address", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(e.target))) });
      const ok = root.querySelector(".acct-saved"); ok.hidden = false; setTimeout(() => (ok.hidden = true), 2000);
    });
  }

  const draw = () => (view === "bag" ? drawBag() : drawAccount());
  root.addEventListener("click", async (e) => {
    const rm = e.target.closest("[data-rm-page]");
    if (rm) { B.remove(rm.dataset.rmPage, rm.dataset.size || ""); return drawBag(); }
    if (e.target.closest("[data-checkout-page]")) return B.checkout();
    if (e.target.closest("[data-signin]")) { if (await B.signIn("Sign in")) drawAccount(); return; }
    if (e.target.closest("[data-signout]")) { await B.signOut(); return drawAccount(); }
  });
  // Wishlist hearts and sign-in change things drawn here.
  let t = null;
  document.addEventListener("vx-bag", () => { clearTimeout(t); t = setTimeout(() => { if (!document.querySelector("dialog[open]")) draw(); }, 300); });
  load().then(draw);
})();
