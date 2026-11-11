// "Order now" checkout: 1 Details -> 2 Pay -> 3 Thank-you celebration (live status until the owner confirms).
// Payment is direct to the shop (UPI / bank / phone number); the owner verifies it in his own
// bank app and confirms from WhatsApp. No payment gateway, no fees.
window.VXCheckout = (() => {
  const S = window.SHOP;
  const PAY = S.pay;
  const O = () => window.VXOrder;
  const isPhone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  // A phone can't scan its own screen, so phones get a button per app. upi:// alone opens only the
  // default app (iOS has no picker at all), so each app gets its own link with the same amount and note.
  const UPI_APPS = [["GPay", isIOS ? "gpay://upi/pay" : "tez://upi/pay"], ["PhonePe", "phonepe://pay"], ["Paytm", "paytmmp://pay"]];

  let dlg = null, state = null, poll = null, clock = null, closing = null, fx = null;

  // Two order forms, half of visitors each: "a" asks for name and number, "b" asks for the number only and
  // takes the name on the pay screen. The same visitor always gets the same one. ?form=a or ?form=b pins it.
  function formArm() {
    try {
      const asked = new URLSearchParams(location.search).get("form");
      if (asked === "a" || asked === "b") localStorage.setItem("vx-form", asked);
      const pinned = localStorage.getItem("vx-form");
      if (pinned === "a" || pinned === "b") return pinned;
      const v = JSON.parse(localStorage.getItem("vx-a") || "{}").v || "";
      if (!/^[a-f0-9]{16}$/.test(v)) return "a";
      let h = 2166136261;
      for (const c of v + "form1") { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
      return (h >>> 0) % 100 < 50 ? "a" : "b";
    } catch { return "a"; }
  }

  const COPY = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>`;

  function upiLink(amount, note) {
    // A bank merchant ID wants the name and terminal printed in its own QR (shop.json: upiName, upiRef).
    const q = new URLSearchParams({ pa: PAY.upiId, pn: PAY.upiName || PAY.payee, ...(PAY.upiRef ? { tr: PAY.upiRef } : {}), am: String(amount), cu: "INR", tn: note });
    return `upi://pay?${q.toString().replace(/\+/g, "%20")}`;
  }

  // Each app gets its own button in its own colours, with a small mark drawn here (no image files):
  // Google's four-colour G, PhonePe's "पे" on purple, Paytm's two-tone name. The marks that are words
  // are drawn by the stylesheet, so a screen reader hears only the app's name.
  const G_MARK = `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;
  const APP_MARK = { GPay: G_MARK, PhonePe: "", Paytm: "", other: "" };
  function upiButtons(link) {
    const { esc } = O();
    const query = link.slice(link.indexOf("?"));
    const one = (name, href, key) => `<a class="btn co-app co-app-${key.toLowerCase()}" href="${esc(href)}" data-upi="${key}"><i class="co-ic" aria-hidden="true">${APP_MARK[key] || ""}</i>${name}</a>`;
    return `<div class="co-upi-apps">${UPI_APPS.map(([name, base]) => one(name, base + query, name)).join("")}${one("Other UPI app", link, "other")}</div>`;
  }

  function qrSvg(text) {
    const qr = window.qrcode(0, "M");
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
  }

  function steps(n) {
    const names = ["Details", "Pay", "Done"];
    return `<ol class="co-steps">${names.map((s, i) => `<li class="${i + 1 < n ? "done" : i + 1 === n ? "now" : ""}"><span>${i + 1 < n ? "✓" : i + 1}</span>${s}</li>`).join("")}</ol>`;
  }

  function itemRow(p) {
    const { esc, rupees, lot, hash } = O();
    const pic = p.image ? `<img src="${esc(p.image)}" alt="">` : window.productArt(p, hash(p.id));
    return `<div class="ask-item"><div class="ask-thumb ${p.image ? "" : "art-bg"}">${pic}</div>
      <div><span class="brand">${esc(p.brand || p.category)}</span><b>${esc(p.name)}</b><span class="mono">${rupees(p.price)}${p.chosenSize ? ` · ${esc(p.chosenSize)}` : ""} · ${lot(p)}</span></div></div>`;
  }

  // Every piece being bought, small, at the top of each step.
  function bagRows() {
    const { esc, rupees, hash } = O();
    const lines = state.lines;
    if (lines.length === 1) {
      const l = lines[0];
      return itemRow({ id: l.productId, name: l.productName, image: l.image, price: l.price * (l.qty || 1), chosenSize: l.size, code: (l.lot || "").replace(/^LOT /, ""), brand: "", category: "" });
    }
    return `<ul class="co-lines">${lines.map((l) => {
      const pic = l.image ? `<img src="${esc(l.image)}" alt="">` : window.productArt?.({ id: l.productId, name: l.productName }, hash(l.productId)) || "";
      return `<li><span class="co-lthumb">${pic}</span><span class="co-lname">${esc(l.productName)}${l.size ? ` <i>${esc(l.size)}</i>` : ""}</span><b class="mono">${rupees(l.price * (l.qty || 1))}</b>${state.order ? "" : `<button type="button" class="co-lrm" data-co-rm="${esc(l.productId)}" data-rm-size="${esc(l.size || "")}" aria-label="Remove ${esc(l.productName)}">Remove</button>`}</li>`;
    }).join("")}</ul>`;
  }
  const title = () => state.lines.length === 1 ? state.lines[0].productName : `${state.lines[0].productName} + ${state.lines.length - 1} more`;

  // The pay screen has no cross: tapping outside the box, or "Change details", leaves it.
  function shell(inner, cross = true) {
    dlg.innerHTML = `<div class="co">${cross ? `<button type="button" class="ask-x" data-close aria-label="Close">×</button>` : ""}${inner}</div>`;
    if (fx) dlg.appendChild(fx.canvas); // a status update mustn't cut the celebration short
  }

  // ---------- Step 1: details ----------
  function stepDetails(err = "") {
    const { esc } = O();
    const f = state.form, goods = state.goods;
    const short = state.arm === "b";
    const C = S.policy?.courier;
    const shipNote = C?.perKg ? `${C.insideKashmirPerKg ? `${O().rupees(C.insideKashmirPerKg)}/kg inside Kashmir, ` : ""}${O().rupees(C.perKg)}/kg outside Kashmir, shown before you pay.` : PAY.shippingFee == null ? "Courier charge depends on your location. We'll tell you the exact amount on WhatsApp before dispatch; if you don't want to pay it, cancel for a full refund." : PAY.shippingFee === 0 ? "Free shipping." : `Shipping: ${O().rupees(PAY.shippingFee)}.`;
    const coinBox = state.coinsUsable > 0
      ? `<label class="co-hide co-coins"><input type="checkbox" name="useCoins" value="1" ${f.useCoins !== "" ? "checked" : ""}><span>Use <b>${state.coinsUsable}</b> coins: ${O().rupees(state.coinsUsable)} off</span></label>`
      : state.coinsBalance > 0 ? `<p class="co-small co-coins">🪙 You have ${state.coinsBalance} coins. You can spend them when Vibe X opens coin offers.</p>` : "";
    // One short screen: what they're buying, how to reach them, how they want it, one button.
    const first = state.lines[0], more = state.lines.length - 1;
    const pic = first.image ? `<img src="${esc(first.image)}" alt="">` : window.productArt?.({ id: first.productId, name: first.productName }, O().hash(first.productId)) || "";
    // The top of the screen is a small bill: the pieces, then delivery, then coins, then the total.
    // Its last rows are filled in by showFee() below as the choice and the PIN change.
    const billRows = `<p class="co-brow" data-bill-del hidden><span></span><b></b></p><p class="co-brow" data-bill-coins hidden><span>Coins</span><b></b></p><p class="co-brow co-btotal" data-bill-total hidden><span>Total</span><b></b></p>`;
    shell(`<div class="co-details">
      <div class="co-bill">
        ${more ? bagRows() : `<div class="co-sumrow"><span class="co-sthumb">${pic}</span><span class="co-sname">${esc(first.productName)}${first.size ? ` <i>${esc(first.size)}</i>` : ""}</span><b>${O().rupees(goods)}</b></div>`}
        ${billRows}
      </div>
      <form class="co-form" novalidate>
        <div class="co-group">
          <label class="co-line"><span class="co-pre"><i class="co-wamark" aria-hidden="true">${WA_ICON}</i>+91</span><input name="phone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="WhatsApp number" aria-label="WhatsApp number" maxlength="20" value="${esc(f.phone || "")}" required></label>
          ${short ? "" : `<label class="co-line"><input name="name" autocomplete="name" maxlength="60" placeholder="Your name" aria-label="Your name" value="${esc(f.name || "")}" required></label>`}
        </div>
        ${short && f.name ? `<input type="hidden" name="name" value="${esc(f.name)}">` : ""}
        <fieldset class="co-choice co-seg"><legend class="co-sr">How do you want it?</legend>
          <label><input type="radio" name="delivery" value="pickup" ${f.delivery === "pickup" ? "checked" : ""}><span>Pick up</span></label>
          <label><input type="radio" name="delivery" value="ship" ${f.delivery === "ship" ? "checked" : ""}><span>Deliver</span></label>
        </fieldset>
        <div class="co-ship" ${f.delivery === "ship" ? "" : "hidden"}>
          <div class="co-group">
            <label class="co-line"><input name="address" autocomplete="street-address" maxlength="300" value="${esc(f.address || "")}" placeholder="House, street, area" aria-label="Address"></label>
            <div class="co-line co-two">
              <label><input name="city" autocomplete="address-level2" maxlength="60" value="${esc(f.city || "")}" placeholder="City" aria-label="City"></label>
              <label><input name="pin" inputmode="numeric" autocomplete="postal-code" maxlength="6" value="${esc(f.pin || "")}" placeholder="PIN code" aria-label="PIN code"></label>
            </div>
          </div>
          <p class="co-small co-fee" role="status" hidden></p>
        </div>
        <input name="website" tabindex="-1" autocomplete="off" class="ask-trap" aria-hidden="true">
        ${short && !f.name ? "" : `<label class="co-hide"><input type="checkbox" name="hideName" value="1" ${f.hideName ? "checked" : ""}><span>Don't show my name on the site</span></label>`}
        ${coinBox}
        <p class="ask-err" role="alert" ${err ? "" : "hidden"}>${esc(err)}</p>
        <button class="order co-cta" type="submit">Pay · ${O().rupees(goods)}</button>
        ${waOrder()}
        <p class="consent">${short && !f.name ? "Your number is used only for this order, and kept on this device for next time." : "Your name and number are used only for this order, and kept on this device for next time. Unless you tick the box, the site may show your first name and city with what you bought."} <a href="/privacy" target="_blank" rel="noopener">Privacy policy</a></p>
      </form>
    </div>`);
    const form = dlg.querySelector("form");
    O().keepDetails(form);
    // "Or order on WhatsApp" stays out of the way of Pay. It comes up for someone who has stalled: 20 seconds
    // on this form without continuing, or an error. Once shown it stays. Shown and pressed are both counted.
    const showWa = () => { const a = dlg.open && dlg.querySelector("[data-co-wa]"); if (!a || state.waShown || state.order) return; state.waShown = true; a.hidden = false; window.VXTrack?.("nudge", { x: "wa_order" }); };
    clearTimeout(state.waTimer);
    if (err) showWa(); else if (!state.waShown) state.waTimer = setTimeout(showWa, 20000);
    form.querySelector("[data-co-wa]")?.addEventListener("click", () => window.VXTrack?.("nudge_tap", { x: "wa_order" }));
    form.addEventListener("change", (e) => {
      if (e.target.name === "delivery") {
        form.querySelector(".co-ship").hidden = e.target.value !== "ship";
        const er = form.querySelector(".ask-err"); if (/pick up or delivery/i.test(er.textContent)) er.hidden = true;
        showFee();
      }
      if (e.target.name === "useCoins") showFee();
    });
    // The courier charge is shown before payment, and it comes from the server, which also sets the order's total.
    let asked = 0;
    const coinsOff = () => (form.elements.useCoins?.checked ? state.coinsUsable : 0);
    async function showFee() {
      const { rupees } = O(), pin = form.elements.pin.value.replace(/\D/g, ""), mine = ++asked, box = form.querySelector(".co-fee");
      const how = form.elements.delivery.value, unknownFee = !C?.perKg && PAY.shippingFee == null;
      let fee = 0, text = "", label = "", value = "", soft = false;
      if (how === "pickup") { label = "Pick up at the store"; value = "Free"; }
      else if (how === "ship") {
        label = "Delivery"; value = "Add your PIN code"; soft = true;
        if (/^[1-9]\d{5}$/.test(pin)) {
          const r = await fetch("/api/account/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines: state.bag, delivery: "ship", pin, holdToken: window.VXVisit?.s }) }).then((x) => x.json()).catch(() => null);
          if (mine !== asked) return;
          if (r?.shipping) { fee = r.shipping; label = `Delivery${r.kg ? ` · ${r.kg} kg` : ""}`; value = rupees(fee); soft = false; }
          else if (r?.inside || unknownFee) { value = "Told on WhatsApp"; text = "We'll tell you the courier charge on WhatsApp before dispatch. If you don't want to pay it, cancel for a full refund."; }
          else if (r) { value = "Free"; soft = false; }
        }
      }
      const row = (sel, on, a, b2, quiet) => { const el = dlg.querySelector(sel); if (!el) return; el.hidden = !on; if (a != null) el.firstChild.textContent = a; el.lastChild.textContent = b2; el.classList.toggle("soft", Boolean(quiet)); };
      const total = goods - coinsOff() + fee;
      row("[data-bill-del]", Boolean(label), label, value, soft);
      row("[data-bill-coins]", coinsOff() > 0, null, `− ${rupees(coinsOff())}`);
      row("[data-bill-total]", Boolean(label) || coinsOff() > 0 || state.lines.length > 1, null, rupees(total));
      box.textContent = text; box.hidden = !text;
      form.querySelector(".co-cta").textContent = `Pay · ${rupees(total)}`;
    }
    form.elements.pin.addEventListener("input", showFee);
    showFee();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      // Nothing is ticked for a new customer (so the address boxes stay out of the way): ask, never guess.
      if (!form.elements.delivery.value) { const er = form.querySelector(".ask-err"); er.textContent = "Choose pick up or delivery."; er.hidden = false; showWa(); form.querySelector(".co-choice").scrollIntoView({ block: "center", behavior: "smooth" }); return; }
      O().tidyPhone(form.elements.phone);
      state.form = Object.fromEntries(new FormData(form));
      O().rememberDetails(state.form);
      if (form.elements.useCoins) state.form.useCoins = form.elements.useCoins.checked ? "1" : "";
      const btn = form.querySelector(".co-cta");
      btn.disabled = true;
      btn.textContent = "One moment…";
      try {
        const res = await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...state.form, useCoins: Boolean(state.form.useCoins), holdToken: window.VXVisit?.s, lines: state.bag, form: state.arm, ...(short ? { nameLater: true } : {}) }) });
        const out = await res.json().catch(() => ({}));
        if (res.status === 409 && out.problems && window.VXBag) { dlg.close(); window.VXBag.openSheet(); return; }
        if (!res.ok) throw new Error(out.error || "Couldn't start the order. Please try again.");
        state.order = out;
        state.endsAt = Date.now() + out.left;
        state.windowMs = out.left;
        state.ranOut = false;
        window.VXTrack?.("details", { pr: state.lines[0].productId, n: goods, k: state.lines.length });
        if (state.form.name) window.VXOrder.rememberName(state.form.name);
        stepPay();
      } catch (ex) {
        window.VXTrack?.("formerr", { x: ex.message });
        stepDetails(ex.message);
      }
    });
    // On a phone the keyboard would jump up over the form the moment it opens: only computers get the cursor.
    if (!matchMedia("(pointer: coarse)").matches) form.querySelector("input[name=phone]").focus();
  }

  // For people who'd rather talk first: the same order, written out, on WhatsApp.
  function waOrder() {
    if (!S.whatsapp) return "";
    const items = state.lines.map((l) => `${l.productName}${l.size ? ` (${l.size})` : ""} ${O().rupees(l.price * (l.qty || 1))}`).join(", ");
    const text = `Hi Vibe X, I'd like to order: ${items}.`;
    return `<a class="co-wa" href="https://wa.me/${O().esc(S.whatsapp)}?text=${encodeURIComponent(text)}" target="_blank" rel="noopener" data-co-wa ${state.waShown ? "" : "hidden"}>${WA_ICON}Or order on WhatsApp</a>`;
  }

  // One tap opens a chat with the shop, with the order code already written. When the customer sends it,
  // the shop has their real WhatsApp number and name beside the order, and a chat to send updates in.
  const WA_ICON = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg>`;
  function waUpdates(o, paid) {
    if (!S.whatsapp) return "";
    const text = paid ? `Hi Vibe X, my order ${o.code} (${title()}) is confirmed. Please send my updates here.` : `Hi Vibe X, I've placed order ${o.code} (${title()}). Please send my updates here.`;
    return `<a class="co-updates" href="https://wa.me/${O().esc(S.whatsapp)}?text=${encodeURIComponent(text)}" target="_blank" rel="noopener" data-co-updates>${WA_ICON}<span><b>Get order updates on WhatsApp</b><small>Opens a chat with the shop. Just press send.</small></span></a>`;
  }

  // ---------- Step 2: pay ----------
  // As little as possible: the amount, one tap to pay, and a line that says we're watching for it.
  // Everything else (QR on a phone, UPI ID, pay to number, bank) sits behind "Other ways to pay".
  // The name box and the WhatsApp button come up only once they've had time to pay.
  function stepPay() {
    const { esc, rupees } = O();
    const o = state.order;
    const note = `${o.code} ${o.lot}`;
    const field = (label, value, mono = true) =>
      `<div class="co-field"><span>${label}</span><b class="${mono ? "mono" : ""}">${esc(value)}</b><button type="button" class="co-copy" data-copy="${esc(value)}" aria-label="Copy ${label}">${COPY}<em>Copy</em></button></div>`;
    const link = upiLink(o.amount, note);
    const qr = PAY.qrImage ? `<img src="${esc(PAY.qrImage)}" alt="Vibe X payment QR">` : qrSvg(link);
    const qrBox = `<div class="co-qr">${qr}<p>Scan with any UPI app.${PAY.qrImage ? ` Enter <b>${rupees(o.amount)}</b>.` : ""}</p></div>`;
    const others = `${isPhone ? qrBox : ""}${field("Amount", String(o.amount))}${field("UPI ID", PAY.upiId)}
      ${PAY.phone ? field("GPay / PhonePe / Paytm number", PAY.phone) + `<p class="co-small">The name should show as <b>${esc(PAY.payee)}</b>.</p>` : ""}
      ${PAY.bank && PAY.bank.accountNumber ? field("Account name", PAY.bank.accountName, false) + field("Account number", PAY.bank.accountNumber) + field("IFSC", PAY.bank.ifsc) + `<p class="co-small">${esc(PAY.bank.bankName)}. IMPS, NEFT or UPI to account all work.</p>` : ""}
      <p class="co-small">Add <b class="mono">${esc(o.code)}</b> in the payment note so we can match it.</p>`;
    const extras = `${o.noName ? `<form class="co-name" novalidate><label>Name for the order <i>(optional)</i><span class="co-name-row"><input name="name" autocomplete="name" maxlength="60" enterkeyhint="done" value="${esc(state.nameDraft || "")}"><button type="submit" class="btn btn-line">Save</button></span></label><p class="ask-err" role="alert" hidden></p></form>` : o.nameSaved ? `<p class="co-small co-name-ok">✓ Order is in the name of <b>${esc(o.nameSaved)}</b>.</p>` : ""}${waUpdates(o)}`;
    shell(`<div class="co-paynow">
      ${PAY.demo ? `<p class="co-demo">Demo payment details. Don't send real money.</p>` : ""}
      <div class="co-amount"><span>Pay</span><b>${rupees(o.amount)}</b></div>
      ${o.shipping || o.coinsUsed ? `<p class="co-small co-sum">${rupees(o.goods)}${o.coinsUsed ? ` − ${rupees(o.coinsUsed)} coins` : ""}${o.shipping ? ` + ${rupees(o.shipping)} courier` : ""}</p>` : ""}
      ${isPhone ? "" : `<div class="co-pay">${qrBox}</div>`}
      <div class="co-ring" role="timer" aria-label="Time left to pay"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="co-ring-track" cx="50" cy="50" r="44"/><circle class="co-ring-area" data-ring cx="50" cy="50" r="23.5" pathLength="100" stroke-dasharray="100.4 100" stroke-dashoffset="0"/><circle class="co-ring-left" data-ring cx="50" cy="50" r="44" pathLength="100" stroke-dasharray="100.4 100" stroke-dashoffset="0"/></svg><b data-clock></b></div>
      <div class="co-later" ${state.later ? "" : "hidden"}>${extras}</div>
      ${isPhone ? `<div class="co-pay">${upiButtons(link)}</div>` : ""}
      <details class="co-qr-more"><summary>${isPhone ? "Show QR" : "Other ways to pay"}</summary>${others}</details>
      <p class="co-foot"><span class="mono">Order ${esc(o.code)}</span><button type="button" class="co-back" data-back>Change details</button></p>
    </div>`, false);
    // The name box and the WhatsApp button come up only once they have started paying: a tap on a UPI app,
    // or a copied UPI ID / number / amount. A QR scan from another phone can't be seen, so on a computer
    // they also come up after half a minute.
    const later = () => { state.later = true; const box = dlg.querySelector(".co-later"); if (box) box.hidden = false; };
    if (!state.later) {
      dlg.querySelector(".co-paynow").addEventListener("click", (e) => { if (e.target.closest("[data-upi], [data-copy]")) setTimeout(later, 600); });
      clearTimeout(state.laterTimer);
      if (!isPhone) state.laterTimer = setTimeout(later, 30000);
    }
    dlg.querySelector(".co-qr-more").addEventListener("toggle", (e) => { if (e.target.open) window.VXTrack?.("pay_tab", { x: "other" }); });
    const nf = dlg.querySelector(".co-name");
    if (nf) {
      nf.elements.name.addEventListener("input", (e) => { state.nameDraft = e.target.value; });
      nf.addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = nf.elements.name.value.replace(/\s+/g, " ").trim(), er = nf.querySelector(".ask-err"), btn = nf.querySelector("button");
        if (!name) { nf.elements.name.focus(); return; }
        btn.disabled = true; er.hidden = true;
        try {
          const res = await fetch(`/api/orders/${o.id}/name`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
          const out = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(out.error || "Couldn't save. Please try again.");
          o.noName = false; o.nameSaved = out.name || name; state.form.name = o.nameSaved; state.nameDraft = "";
          O().rememberDetails({ name: o.nameSaved }); O().rememberName(o.nameSaved);
          nf.outerHTML = `<p class="co-small co-name-ok">✓ Order is in the name of <b>${esc(o.nameSaved)}</b>.</p>`;
        } catch (ex) { er.textContent = ex.message; er.hidden = false; btn.disabled = false; }
      });
    }
    startClock();
    watch();
  }

  // ---------- The window: a countdown, and the shop's answer ----------
  function startClock() {
    clearInterval(clock);
    const tick = () => {
      const ms = Math.max(0, state.endsAt - Date.now()), s = Math.ceil(ms / 1000), el = dlg.querySelector("[data-clock]");
      if (el) { el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; el.classList.toggle("low", s <= 60); }
      // The ring empties as the time runs out.
      // (two shapes: the line round the edge, and the filled slice inside it)
      for (const ring of dlg.querySelectorAll("[data-ring]")) { ring.setAttribute("stroke-dashoffset", String(100.4 * (1 - Math.max(0, Math.min(1, ms / (state.windowMs || ms || 1)))))); ring.classList.toggle("low", s <= 60); }
    };
    tick();
    clock = setInterval(tick, 1000);
  }
  function stopWatching() { clearInterval(poll); clearInterval(clock); clearTimeout(closing); }
  function watch() {
    clearInterval(poll);
    const o = state.order;
    poll = setInterval(async () => {
      try {
        const out = await (await fetch(`/api/orders/${o.id}`, { cache: "no-store" })).json();
        if (out.status === "confirmed" || out.status === "cancelled") stepDone(out.status);
        else if (out.status === "lapsed" && !state.ranOut) stepExpired();
      } catch { /* try again */ }
    }, 2500);
  }

  // Never "failed": they may have paid, and a late confirm still reaches this screen.
  function stepExpired() {
    const { esc } = O(), o = state.order;
    state.ranOut = true;
    window.VXTrack?.("pay", { x: "late" });
    clearInterval(clock);
    const text = `Hi Vibe X, I paid for order ${o.code} (${title()}). Here's my payment screenshot.`;
    shell(`${steps(2)}
      <div class="co-done">
        <p class="mono co-code">Order ${esc(o.code)}</p>
        <h2>We couldn't confirm your payment yet</h2>
        <p>Already paid? Send your screenshot on WhatsApp with code <b class="mono">${esc(o.code)}</b> and we'll sort it out. If you haven't paid, nothing has been charged.</p>
        <a class="btn btn-ink" href="https://wa.me/${esc(S.whatsapp)}?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">Send on WhatsApp</a>
        <button type="button" class="co-back" data-close>Back to the rack</button>
      </div>`);
  }

  // Payment opens with the shop: outside its hours nobody is there to confirm in time.
  function stepClosed() {
    const { esc } = O();
    const text = `Hi Vibe X, I'd like to order: ${state.lines.map((l) => `${l.productName}${l.size ? ` (${l.size})` : ""}`).join(", ")}.`;
    shell(`<div class="co-done">
        <h2>We're closed for online payment</h2>
        <p>${esc(PAY.closedText)}</p>
        <a class="btn btn-ink" href="https://wa.me/${esc(S.whatsapp)}?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">Order on WhatsApp</a>
        <button type="button" class="co-back" data-close>Back to the rack</button>
      </div>`);
  }
  function payOpen() {
    const w = PAY.window, h = new Date(Date.now() + 5.5 * 3600e3).getUTCHours();
    return !w || (h >= w.opensHour && h < w.closesHour);
  }

  // ---------- Celebration: emotes, confetti and glitter across the whole screen ----------
  function stopFx() {
    if (!fx) return;
    cancelAnimationFrame(fx.raf);
    fx.canvas.remove();
    fx = null;
  }

  function celebrate() {
    stopFx();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = document.createElement("canvas");
    canvas.className = "co-fx";
    canvas.setAttribute("aria-hidden", "true");
    const W = innerWidth, H = innerHeight, dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
    dlg.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    const rnd = (a, b) => a + Math.random() * (b - a);
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const k = Math.max(0.55, Math.min(1, (W * H) / (1400 * 900))); // fewer pieces on a phone

    // Emoji and glitter are slow to draw fresh, so each is drawn once and stamped.
    const stamp = (draw) => { const c = document.createElement("canvas"); c.width = c.height = 96; draw(c.getContext("2d")); return c; };
    const emotes = ["🎉", "🥳", "🎊", "✨", "🛍️", "💖", "🌟", "🤩"].map((e) => stamp((x) => {
      x.font = '72px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
      x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText(e, 48, 52);
    }));
    const glints = ["#f5c542", "#ffe9a8", "#ffffff", "#e92e30"].map((col) => stamp((x) => {
      x.fillStyle = col;
      x.beginPath();
      for (let i = 0; i < 8; i++) {
        const r = i % 2 ? 7 : 46, a = (i * Math.PI) / 4;
        x.lineTo(48 + r * Math.cos(a), 48 + r * Math.sin(a));
      }
      x.fill();
    }));
    const papers = ["#e92e30", "#f5c542", "#151410", "#ffffff", "#ff8fa3"];

    const parts = [];
    const cannon = (side, n, delay) => {
      for (let i = 0; i < n * k; i++) {
        const angle = rnd(0.95, 1.5), speed = H * rnd(1.1, 2.2);
        const emote = Math.random() < 0.3;
        parts.push({
          born: delay + rnd(0, 0.22), life: rnd(3, 4.4), x: side ? W + 10 : -10, y: H + 10,
          vx: (side ? -1 : 1) * Math.cos(angle) * speed, vy: -Math.sin(angle) * speed, g: H * 1.15, drag: 1.1,
          rot: rnd(0, 6.3), spin: rnd(-7, 7), size: emote ? rnd(26, 44) : rnd(7, 13),
          img: emote ? pick(emotes) : null, col: pick(papers),
        });
      }
    };
    cannon(0, 70, 0); cannon(1, 70, 0.05); cannon(0, 40, 0.7); cannon(1, 40, 0.8);
    for (let i = 0; i < 70 * k; i++) { // emotes raining from the top
      parts.push({
        born: rnd(0.1, 3.2), life: 3.4, x: rnd(0, W), y: -50, vx: rnd(-30, 30), vy: H * rnd(0.26, 0.44), g: 0, drag: 0,
        rot: rnd(-0.4, 0.4), spin: rnd(-1.2, 1.2), size: rnd(24, 46), img: pick(emotes),
      });
    }
    for (let i = 0; i < 200 * k; i++) { // glitter twinkling all over
      parts.push({
        born: rnd(0, 4.4), life: rnd(0.6, 1.4), x: rnd(0, W), y: rnd(0, H), vx: 0, vy: 14, g: 0, drag: 0,
        rot: rnd(0, 0.8), spin: rnd(-1, 1), size: rnd(10, 26), img: pick(glints), twinkle: true,
      });
    }

    const start = performance.now();
    let last = start;
    const frame = (now) => {
      const t = (now - start) / 1000, dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = 0;
      for (const p of parts) {
        const age = t - p.born;
        if (age > p.life) continue;
        alive++;
        if (age < 0) continue;
        p.vx -= p.vx * p.drag * dt;
        p.vy += (p.g - p.vy * p.drag) * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.spin * dt;
        ctx.globalAlpha = p.twinkle ? Math.sin((age / p.life) * Math.PI) : Math.min(1, (p.life - age) * 2);
        const c = Math.cos(p.rot) * dpr, s = Math.sin(p.rot) * dpr;
        ctx.setTransform(c, s, -s, c, p.x * dpr, p.y * dpr);
        if (p.img) ctx.drawImage(p.img, -p.size / 2, -p.size / 2, p.size, p.size);
        else { ctx.fillStyle = p.col; ctx.fillRect(-p.size / 2, (-p.size / 3) * Math.abs(Math.cos(age * 8)), p.size, (p.size * 2 / 3) * Math.abs(Math.cos(age * 8)) + 1); }
      }
      if (alive) fx.raf = requestAnimationFrame(frame); else stopFx();
    };
    fx = { canvas, raf: requestAnimationFrame(frame) };
  }

  // ---------- Step 3: the shop has answered ----------
  function stepDone(status) {
    const { esc } = O();
    const o = state.order, confirmed = status === "confirmed";
    stopWatching();
    state.order = null; // finished: Order now must start afresh, not reopen this payment
    if (confirmed) {
      shell(`<div class="co-done is-ok"><h2 class="co-thanks">Thanks For The Purchase</h2><p class="mono co-code">Order ${esc(o.code)}</p>${waUpdates(o, true)}</div>`);
      // Counted here, not on a button: a sale is a sale once the shop has the money.
      window.VXTrack?.("paid", { pr: state.lines[0].productId, n: o.goods - (o.coinsUsed || 0), fp: o.goods, k: state.lines.length });
      window.VXBag?.ordered(state.lines);
      celebrate();
      closing = setTimeout(() => dlg.close(), 10000);
      return;
    }
    shell(`${steps(3)}
      <div class="co-done is-bad">
        <span class="co-badge">!</span>
        <p class="mono co-code">Order ${esc(o.code)}</p>
        <h2>We couldn't match your payment</h2>
        <p>Vibe X will message you on WhatsApp to sort it out.</p>
        <button type="button" class="btn btn-ink" data-close>Back to the rack</button>
      </div>`);
    stopFx();
  }

  function copyText(btn) {
    const text = btn.dataset.copy;
    const done = () => { const em = btn.querySelector("em"); if (em) { em.textContent = "Copied"; setTimeout(() => (em.textContent = "Copy"), 1500); } };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, done);
    else {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
      dlg.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch { /* ignore */ }
      ta.remove(); done();
    }
  }

  // Changed their mind about one piece while filling the form: it goes, the total follows, and what they typed stays.
  async function dropLine(id, size) {
    if (state.order || !window.VXBag) return;
    const f = dlg.querySelector(".co-form");
    if (f) state.form = { ...state.form, ...Object.fromEntries(new FormData(f)) };
    window.VXBag.remove(id, size);
    const q = await window.VXBag.quote();
    if (!q.lines?.length) return dlg.close();
    state.bag = q.lines.map((l) => ({ id: l.productId, size: l.size || "", qty: l.qty || 1 }));
    state.lines = q.lines; state.goods = q.goods; state.coinsUsable = q.coinsUsable || 0; state.coinsBalance = q.coinsBalance || 0;
    stepDetails();
  }
  function openBag(q, me) {
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.className = "ask-dialog co-dialog";
      document.body.appendChild(dlg);
      dlg.addEventListener("close", () => { stopWatching(); stopFx(); clearTimeout(state?.waTimer); window.VXTrack?.("co_close"); });
      dlg.addEventListener("click", (e) => {
        if (e.target === dlg || e.target.closest("[data-close]")) return dlg.close();
        
        const c = e.target.closest("[data-copy]"); if (c) return copyText(c);
        const rm = e.target.closest("[data-co-rm]"); if (rm) return dropLine(rm.dataset.coRm, rm.dataset.rmSize || "");
        if (e.target.closest("[data-co-updates]")) clearTimeout(closing); // the thank-you stays up while they are in WhatsApp
        if (e.target.closest("[data-back]")) {
          stopWatching();
          if (state.order) fetch(`/api/orders/${state.order.id}/cancel`, { method: "POST" }).catch(() => {});
          state.order = null;
          return stepDetails();
        }
      });
    }
    stopWatching();
    const bag = q.lines.map((l) => ({ id: l.productId, size: l.size || "", qty: l.qty || 1 }));
    const same = state?.order && JSON.stringify(state.bag) === JSON.stringify(bag);
    // Closed the box by accident, or went to the UPI app and came back: pick up the same order.
    if (same && !state.ranOut && state.endsAt > Date.now()) { stepPay(); dlg.showModal(); return; }
    const a = me?.address || {};
    // The account first (it follows the customer's cookie), then what this browser remembers from a form.
    const dev = O().savedDetails();
    const saved = { name: a.name || me?.name || dev.name || "", phone: a.phone || me?.phone || dev.phone || "", delivery: a.delivery || dev.delivery || "", address: a.address || dev.address || "", city: a.city || dev.city || "", pin: a.pin || dev.pin || "" };
    state = { bag, lines: q.lines, goods: q.goods, coinsUsable: q.coinsUsable || 0, coinsBalance: q.coinsBalance || 0, form: state && state.form ? { ...state.form } : saved, order: null, later: false, waShown: false, arm: formArm() };
    if (payOpen()) stepDetails(); else stepClosed();
    dlg.showModal();
    window.VXTrack?.("checkout", { pr: q.lines[0].productId, n: q.goods, k: q.lines.length, x: state.arm });
  }
  // Without the bag script (old pages): one piece, straight to checkout.
  function open(p) {
    openBag({ lines: [{ productId: p.id, productName: p.name, size: p.chosenSize || "", price: p.price, qty: 1, image: p.image, lot: O().lot(p) }], goods: p.price }, window.VXBag?.me());
  }
  return { open, openBag };
})();
