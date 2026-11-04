// "Order now" checkout: 1 Details -> 2 Pay -> 3 Thank-you celebration (live status until the owner confirms).
// Payment is direct to the shop (UPI / bank / phone number); the owner verifies it in his own
// bank app and confirms from WhatsApp. No payment gateway, no fees.
window.VXCheckout = (() => {
  const S = window.SHOP;
  const PAY = S.pay;
  const O = () => window.VXOrder;
  const isPhone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

  let dlg = null, state = null, poll = null, fx = null;

  const COPY = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>`;

  function upiLink(amount, note) {
    const q = new URLSearchParams({ pa: PAY.upiId, pn: PAY.payee, am: String(amount), cu: "INR", tn: note });
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
      <div><span class="brand">${esc(p.brand || p.category)}</span><b>${esc(p.name)}</b><span class="mono">${rupees(p.price)} · ${lot(p)}</span></div></div>`;
  }

  function shell(inner) {
    dlg.innerHTML = `<div class="co"><button type="button" class="ask-x" data-close aria-label="Close">×</button>${inner}</div>`;
    if (fx) dlg.appendChild(fx.canvas); // a status update mustn't cut the celebration short
  }

  // ---------- Step 1: details ----------
  function stepDetails(err = "") {
    const { esc } = O();
    const p = state.p, f = state.form;
    const shipNote = PAY.shippingFee == null ? "Courier charge depends on your location. We'll tell you the exact amount on WhatsApp before dispatch; if you don't want to pay it, cancel for a full refund." : PAY.shippingFee === 0 ? "Free shipping." : `Shipping: ${O().rupees(PAY.shippingFee)}.`;
    shell(`${steps(1)}${itemRow(p)}
      <form class="co-form" novalidate>
        <h2>Order now</h2>
        <label>Your name<input name="name" autocomplete="name" maxlength="60" value="${esc(f.name || "")}" required></label>
        <label>WhatsApp number<div class="ask-phone"><span>+91</span><input name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="98765 43210" maxlength="14" value="${esc(f.phone || "")}" required></div></label>
        <fieldset class="co-choice"><legend>How do you want it?</legend>
          <label><input type="radio" name="delivery" value="pickup" ${f.delivery !== "ship" ? "checked" : ""}><span><b>Pick up in Srinagar</b><small>Collect from the store</small></span></label>
          <label><input type="radio" name="delivery" value="ship" ${f.delivery === "ship" ? "checked" : ""}><span><b>Deliver to me</b><small>Anywhere in India. ${esc(shipNote)}</small></span></label>
        </fieldset>
        <div class="co-ship" ${f.delivery === "ship" ? "" : "hidden"}>
          <label>Address<input name="address" autocomplete="street-address" maxlength="300" value="${esc(f.address || "")}" placeholder="House, street, area"></label>
          <div class="co-row">
            <label>City<input name="city" autocomplete="address-level2" maxlength="60" value="${esc(f.city || "")}"></label>
            <label>PIN code<input name="pin" inputmode="numeric" autocomplete="postal-code" maxlength="6" value="${esc(f.pin || "")}"></label>
          </div>
        </div>
        <input name="website" tabindex="-1" autocomplete="off" class="ask-trap" aria-hidden="true">
        <p class="ask-err" role="alert" ${err ? "" : "hidden"}>${esc(err)}</p>
        <button class="order co-cta" type="submit">Continue to payment · ${O().rupees(p.price)}</button>
        <p class="consent">We use your name and number only for this order and its delivery. <a href="/privacy" target="_blank" rel="noopener">Privacy policy</a></p>
      </form>`);
    const form = dlg.querySelector("form");
    form.addEventListener("change", (e) => {
      if (e.target.name === "delivery") form.querySelector(".co-ship").hidden = e.target.value !== "ship";
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      state.form = Object.fromEntries(new FormData(form));
      const btn = form.querySelector(".co-cta");
      btn.disabled = true;
      btn.textContent = "One moment…";
      try {
        const res = await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...state.form, productId: p.id }) });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || "Couldn't start the order. Please try again.");
        state.order = out;
        stepPay();
      } catch (ex) {
        stepDetails(ex.message);
      }
    });
    form.querySelector("input[name=name]").focus();
  }

  // ---------- Step 2: pay ----------
  function stepPay(tab = state.tab || "upi", err = "") {
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
      <div class="co-amount"><span>Pay exactly</span><b>${rupees(o.amount)}</b><button type="button" class="co-copy" data-copy="${o.amount}" aria-label="Copy amount">${COPY}<em>Copy</em></button></div>
      <p class="co-small">Add <b class="mono">${esc(o.code)}</b> in the payment note so we can match it.</p>
      <div class="co-tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${k === tab}">${l}</button>`).join("")}</div>
      <div class="co-pay">${body}</div>
      <p class="ask-err" role="alert" ${err ? "" : "hidden"}>${esc(err)}</p>
      <button type="button" class="order co-cta" data-paid>I've paid</button>
      <button type="button" class="co-back" data-back>← Change details</button>`);
  }

  // ---------- "I've paid" ----------
  async function markPaid(btn) {
    const o = state.order;
    btn.disabled = true;
    btn.textContent = "One moment…";
    try {
      const res = await fetch(`/api/orders/${o.id}/paid`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || "Couldn't reach the shop. Please try again.");
      stepDone(out.status);
      if (out.status !== "cancelled") celebrate();
    } catch (ex) {
      stepPay(state.tab, ex.message);
    }
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

  // ---------- Step 3: done, with live status ----------
  function stepDone(status) {
    const { esc, rupees } = O();
    const o = state.order, f = state.form;
    const confirmed = status === "confirmed", cancelled = status === "cancelled";
    const when = f.delivery === "ship" ? `We'll ship to ${f.city} and send tracking on WhatsApp.` : "It'll be kept aside for you at the store in Srinagar.";
    shell(`${steps(confirmed ? 4 : 3)}
      <div class="co-done ${confirmed ? "is-ok" : cancelled ? "is-bad" : ""}">
        ${confirmed || cancelled ? `<span class="co-badge">${confirmed ? "✓" : "!"}</span>` : `<p class="co-emotes" aria-hidden="true"><span>🎉</span><span>🥳</span><span>🛍️</span><span>🎊</span></p>`}
        <p class="mono co-code">Order ${esc(o.code)}</p>
        <h2 class="${confirmed || cancelled ? "" : "co-thanks"}">${confirmed ? "Order confirmed" : cancelled ? "We couldn't match your payment" : "Thanks For The Purchase"}</h2>
        <p>${confirmed ? `Vibe X received your ${rupees(o.amount)}. ${when}` : cancelled ? "Vibe X will message you on WhatsApp to sort it out." : `Your piece is held for you while Vibe X checks for your ${rupees(o.amount)}. This page updates by itself, and we'll also WhatsApp you.`}</p>
        <ul class="co-timeline">
          <li class="done">Order placed</li>
          <li class="done">You paid</li>
          <li class="${confirmed ? "done" : cancelled ? "bad" : "now"}">${cancelled ? "Payment not found" : "Vibe X confirms payment"}</li>
          <li class="${confirmed ? "now" : ""}">${f.delivery === "ship" ? "Shipped to you" : "Ready for pickup"}</li>
        </ul>
        <button type="button" class="btn btn-ink" data-close>Back to the rack</button>
      </div>`);
    if (cancelled) stopFx();
    clearInterval(poll);
    if (!confirmed && !cancelled) {
      poll = setInterval(async () => {
        try {
          const r = await fetch(`/api/orders/${o.id}`, { cache: "no-store" });
          const s = (await r.json()).status;
          if (s === "confirmed" || s === "cancelled") stepDone(s);
        } catch { /* try again */ }
      }, 2500);
    }
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

  function open(p) {
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.className = "ask-dialog co-dialog";
      document.body.appendChild(dlg);
      dlg.addEventListener("close", () => { clearInterval(poll); stopFx(); });
      dlg.addEventListener("click", (e) => {
        if (e.target === dlg || e.target.closest("[data-close]")) return dlg.close();
        const t = e.target.closest("[data-tab]"); if (t) return stepPay(t.dataset.tab);
        const c = e.target.closest("[data-copy]"); if (c) return copyText(c);
        const paid = e.target.closest("[data-paid]"); if (paid) return markPaid(paid);
        if (e.target.closest("[data-back]")) return stepDetails();
      });
    }
    clearInterval(poll);
    state = { p, form: state && state.form ? { ...state.form } : {}, order: null, tab: "upi" };
    stepDetails();
    dlg.showModal();
  }

  return { open };
})();
