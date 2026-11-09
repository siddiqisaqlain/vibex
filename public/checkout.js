// "Order now" checkout: 1 Details -> 2 Pay -> 3 Thank-you celebration (live status until the owner confirms).
// Payment is direct to the shop (UPI / bank / phone number); the owner verifies it in his own
// bank app and confirms from WhatsApp. No payment gateway, no fees.
window.VXCheckout = (() => {
  const S = window.SHOP;
  const PAY = S.pay;
  const O = () => window.VXOrder;
  const isPhone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

  let dlg = null, state = null, poll = null, clock = null, closing = null, fx = null;

  const COPY = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>`;

  function upiLink(amount, note) {
    // A bank merchant ID wants the name and terminal printed in its own QR (shop.json: upiName, upiRef).
    const q = new URLSearchParams({ pa: PAY.upiId, pn: PAY.upiName || PAY.payee, ...(PAY.upiRef ? { tr: PAY.upiRef } : {}), am: String(amount), cu: "INR", tn: note });
    return `upi://pay?${q.toString().replace(/\+/g, "%20")}`;
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
      return `<li><span class="co-lthumb">${pic}</span><span class="co-lname">${esc(l.productName)}${l.size ? ` <i>${esc(l.size)}</i>` : ""}</span><b class="mono">${rupees(l.price * (l.qty || 1))}</b></li>`;
    }).join("")}</ul>`;
  }
  const title = () => state.lines.length === 1 ? state.lines[0].productName : `${state.lines[0].productName} + ${state.lines.length - 1} more`;

  function shell(inner) {
    dlg.innerHTML = `<div class="co"><button type="button" class="ask-x" data-close aria-label="Close">×</button>${inner}</div>`;
    if (fx) dlg.appendChild(fx.canvas); // a status update mustn't cut the celebration short
  }

  // ---------- Step 1: details ----------
  function stepDetails(err = "") {
    const { esc } = O();
    const f = state.form, goods = state.goods;
    const C = S.policy?.courier;
    const shipNote = C?.perKg ? `Courier ${O().rupees(C.perKg)}/kg outside Kashmir, shown before you pay.` : PAY.shippingFee == null ? "Courier charge depends on your location. We'll tell you the exact amount on WhatsApp before dispatch; if you don't want to pay it, cancel for a full refund." : PAY.shippingFee === 0 ? "Free shipping." : `Shipping: ${O().rupees(PAY.shippingFee)}.`;
    const coinBox = state.coinsUsable > 0
      ? `<label class="co-hide co-coins"><input type="checkbox" name="useCoins" value="1" ${f.useCoins !== "" ? "checked" : ""}><span>Use <b>${state.coinsUsable}</b> coins: ${O().rupees(state.coinsUsable)} off</span></label>`
      : state.coinsBalance > 0 ? `<p class="co-small co-coins">🪙 You have ${state.coinsBalance} coins. You can spend them when Vibe X opens coin offers.</p>` : "";
    shell(`${steps(1)}${bagRows()}
      <form class="co-form" novalidate>
        <h2>Your details</h2>
        <p class="co-next">Takes 30 seconds. Next you pay by UPI, and we confirm on WhatsApp.</p>
        <label>WhatsApp number<div class="ask-phone"><span>+91</span><input name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="98765 43210" maxlength="14" value="${esc(f.phone || "")}" required></div></label>
        <label>Your name<input name="name" autocomplete="name" maxlength="60" value="${esc(f.name || "")}" required></label>
        <fieldset class="co-choice"><legend>How do you want it?</legend>
          <label><input type="radio" name="delivery" value="pickup" ${f.delivery === "pickup" ? "checked" : ""}><span><b>Pick up in Srinagar</b><small>Collect from the store</small></span></label>
          <label><input type="radio" name="delivery" value="ship" ${f.delivery === "ship" ? "checked" : ""}><span><b>Deliver to me</b><small>Anywhere in India. ${esc(shipNote)}</small></span></label>
        </fieldset>
        <div class="co-ship" ${f.delivery === "ship" ? "" : "hidden"}>
          <label>Address<input name="address" autocomplete="street-address" maxlength="300" value="${esc(f.address || "")}" placeholder="House, street, area"></label>
          <div class="co-row">
            <label>City<input name="city" autocomplete="address-level2" maxlength="60" value="${esc(f.city || "")}"></label>
            <label>PIN code<input name="pin" inputmode="numeric" autocomplete="postal-code" maxlength="6" value="${esc(f.pin || "")}"></label>
          </div>
          <p class="co-small co-fee" role="status" hidden></p>
        </div>
        <input name="website" tabindex="-1" autocomplete="off" class="ask-trap" aria-hidden="true">
        <p class="ask-err" role="alert" ${err ? "" : "hidden"}>${esc(err)}</p>
        <label class="co-hide"><input type="checkbox" name="hideName" value="1" ${f.hideName ? "checked" : ""}><span>Don't show my name on the site</span></label>
        ${coinBox}
        <button class="order co-cta" type="submit">Continue to payment · ${O().rupees(goods)}</button>
        ${waOrder()}
        <p class="consent">We use your name and number only for this order and its delivery. Unless you tick the box, the site may show your first name and city with what you bought. Your first name is also kept on this device, so we can say hello next time. <a href="/privacy" target="_blank" rel="noopener">Privacy policy</a></p>
      </form>`);
    const form = dlg.querySelector("form");
    form.addEventListener("change", (e) => {
      if (e.target.name === "delivery") { form.querySelector(".co-ship").hidden = e.target.value !== "ship"; showFee(); }
      if (e.target.name === "useCoins") showFee();
    });
    // The courier charge is shown before payment, and it comes from the server, which also sets the order's total.
    let asked = 0;
    const coinsOff = () => (form.elements.useCoins?.checked ? state.coinsUsable : 0);
    async function showFee() {
      const { rupees } = O(), pin = form.elements.pin.value.replace(/\D/g, ""), mine = ++asked, box = form.querySelector(".co-fee");
      let fee = 0, text = "";
      if (form.elements.delivery.value === "ship" && /^[1-9]\d{5}$/.test(pin)) {
        const r = await fetch("/api/account/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines: state.bag, delivery: "ship", pin, holdToken: window.VXVisit?.s }) }).then((x) => x.json()).catch(() => null);
        if (mine !== asked) return;
        if (r?.shipping) { fee = r.shipping; text = `Courier to ${pin}: ${rupees(fee)} for ${r.kg} kg. You pay ${rupees(goods - coinsOff() + fee)} in total.`; }
        else if (r?.inside) text = "Inside Kashmir, we'll tell you the courier charge on WhatsApp before dispatch. If you don't want to pay it, cancel for a full refund.";
      }
      box.textContent = text; box.hidden = !text;
      form.querySelector(".co-cta").textContent = `Continue to payment · ${rupees(goods - coinsOff() + fee)}`;
    }
    form.elements.pin.addEventListener("input", showFee);
    showFee();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      // Nothing is ticked for a new customer (so the address boxes stay out of the way): ask, never guess.
      if (!form.elements.delivery.value) { const er = form.querySelector(".ask-err"); er.textContent = "Choose pick up or delivery."; er.hidden = false; form.querySelector(".co-choice").scrollIntoView({ block: "center", behavior: "smooth" }); return; }
      state.form = Object.fromEntries(new FormData(form));
      if (form.elements.useCoins) state.form.useCoins = form.elements.useCoins.checked ? "1" : "";
      const btn = form.querySelector(".co-cta");
      btn.disabled = true;
      btn.textContent = "One moment…";
      try {
        const res = await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...state.form, useCoins: Boolean(state.form.useCoins), holdToken: window.VXVisit?.s, lines: state.bag }) });
        const out = await res.json().catch(() => ({}));
        if (res.status === 409 && out.problems && window.VXBag) { dlg.close(); window.VXBag.openSheet(); return; }
        if (!res.ok) throw new Error(out.error || "Couldn't start the order. Please try again.");
        state.order = out;
        state.endsAt = Date.now() + out.left;
        state.ranOut = false;
        window.VXTrack?.("details", { pr: state.lines[0].productId, n: goods, k: state.lines.length });
        window.VXOrder.rememberName(state.form.name);
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
    return `<a class="co-wa" href="https://wa.me/${O().esc(S.whatsapp)}?text=${encodeURIComponent(text)}" target="_blank" rel="noopener" data-co-wa>Rather order on WhatsApp? Message us →</a>`;
  }

  // ---------- Step 2: pay ----------
  function stepPay(tab = state.tab || "upi") {
    const { esc, rupees } = O();
    state.tab = tab;
    const o = state.order;
    const note = `${o.code} ${o.lot}`;
    // Only the payment options the shop has filled in (shop.json → pay).
    const tabs = [["upi", "UPI / QR"], ["bank", "Bank transfer"], ["number", "Pay to number"]]
      .filter(([k]) => k !== "bank" || (PAY.bank && PAY.bank.accountNumber))
      .filter(([k]) => k !== "number" || PAY.phone);
    const field = (label, value, mono = true) =>
      `<div class="co-field"><span>${label}</span><b class="${mono ? "mono" : ""}">${esc(value)}</b><button type="button" class="co-copy" data-copy="${esc(value)}" aria-label="Copy ${label}">${COPY}<em>Copy</em></button></div>`;
    let body = "";
    if (tab === "upi") {
      const link = upiLink(o.amount, note);
      const qr = PAY.qrImage ? `<img src="${esc(PAY.qrImage)}" alt="Vibe X payment QR">` : qrSvg(link);
      body = `<div class="co-qr">${qr}<p>Scan with GPay, PhonePe, Paytm or any UPI app.${PAY.qrImage ? ` Enter <b>${rupees(o.amount)}</b>.` : " The amount fills in by itself."}</p></div>
        ${isPhone ? `<a class="btn btn-ink co-upi" href="${esc(link)}">Open my UPI app</a>` : ""}
        ${field("UPI ID", PAY.upiId)}`;
    } else if (tab === "bank") {
      body = field("Account name", PAY.bank.accountName, false) + field("Account number", PAY.bank.accountNumber) + field("IFSC", PAY.bank.ifsc) +
        `<p class="co-small">${esc(PAY.bank.bankName)}. IMPS, NEFT or UPI to account all work.</p>`;
    } else {
      body = field("GPay / PhonePe / Paytm", PAY.phone) + `<p class="co-small">Send to this number in any payments app. The name should show as <b>${esc(PAY.payee)}</b>.</p>`;
    }
    shell(`${steps(2)}
      ${PAY.demo ? `<p class="co-demo">Demo payment details. Don't send real money.</p>` : ""}
      <p class="co-timer">Pay within <b data-clock></b></p>
      <div class="co-amount"><span>Pay exactly</span><b>${rupees(o.amount)}</b><button type="button" class="co-copy" data-copy="${o.amount}" aria-label="Copy amount">${COPY}<em>Copy</em></button></div>
      ${o.shipping || o.coinsUsed ? `<p class="co-small">${rupees(o.goods)} for ${state.lines.length > 1 ? `${state.lines.length} pieces` : "the piece"}${o.coinsUsed ? ` − ${rupees(o.coinsUsed)} coins` : ""}${o.shipping ? ` + ${rupees(o.shipping)} courier` : ""}.</p>` : ""}
      <p class="co-small">Add <b class="mono">${esc(o.code)}</b> in the payment note so we can match it.</p>
      <div class="co-tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${k === tab}">${l}</button>`).join("")}</div>
      <div class="co-pay">${body}</div>
      ${window.VXVisit?.arm === "off" ? "" : `<p class="co-small co-promise"><b>Real, or your money back.</b> Cancel any time before dispatch for a full refund.</p>`}
      <p class="co-wait"><i aria-hidden="true"></i>Waiting for Vibe X to see your payment. Keep this page open, it updates by itself.</p>
      <button type="button" class="co-back" data-back>← Change details</button>`);
    startClock();
    watch();
  }

  // ---------- The window: a countdown, and the shop's answer ----------
  function startClock() {
    clearInterval(clock);
    const tick = () => {
      const ms = Math.max(0, state.endsAt - Date.now()), s = Math.ceil(ms / 1000), el = dlg.querySelector("[data-clock]");
      if (el) { el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; el.classList.toggle("low", s <= 60); }
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
      shell(`<div class="co-done is-ok"><h2 class="co-thanks">Thanks For The Purchase</h2><p class="mono co-code">Order ${esc(o.code)}</p></div>`);
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

  function openBag(q, me) {
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.className = "ask-dialog co-dialog";
      document.body.appendChild(dlg);
      dlg.addEventListener("close", () => { stopWatching(); stopFx(); window.VXTrack?.("co_close"); });
      dlg.addEventListener("click", (e) => {
        if (e.target === dlg || e.target.closest("[data-close]")) return dlg.close();
        const t = e.target.closest("[data-tab]"); if (t) { window.VXTrack?.("pay_tab", { x: t.dataset.tab }); return stepPay(t.dataset.tab); }
        const c = e.target.closest("[data-copy]"); if (c) return copyText(c);
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
    const saved = { name: a.name || me?.name || "", phone: a.phone || me?.phone || "", delivery: a.delivery || "", address: a.address || "", city: a.city || "", pin: a.pin || "" };
    state = { bag, lines: q.lines, goods: q.goods, coinsUsable: q.coinsUsable || 0, coinsBalance: q.coinsBalance || 0, form: state && state.form ? { ...state.form } : saved, order: null, tab: "upi" };
    if (payOpen()) stepDetails(); else stepClosed();
    dlg.showModal();
    window.VXTrack?.("checkout", { pr: q.lines[0].productId, n: q.goods, k: q.lines.length });
  }
  // Without the bag script (old pages): one piece, straight to checkout.
  function open(p) {
    openBag({ lines: [{ productId: p.id, productName: p.name, size: p.chosenSize || "", price: p.price, qty: 1, image: p.image, lot: O().lot(p) }], goods: p.price }, window.VXBag?.me());
  }
  return { open, openBag };
})();
