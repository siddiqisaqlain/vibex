// "Order now" checkout: 1 Details -> 2 Pay -> 3 Payment sent (live status until the owner confirms).
// Payment is direct to the shop (UPI / bank / phone number); the owner verifies it in his own
// bank app and confirms from WhatsApp. No payment gateway, no fees.
window.VXCheckout = (() => {
  const S = window.SHOP;
  const PAY = S.pay;
  const O = () => window.VXOrder;
  const isPhone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

  let dlg = null, state = null, poll = null;

  const COPY = `<i class="ph ph-copy" aria-hidden="true"></i>`;

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
    return `<ol class="co-steps">${names.map((s, i) => `<li class="${i + 1 < n ? "done" : i + 1 === n ? "now" : ""}"><span>${i + 1 < n ? '<i class="ph ph-check" aria-hidden="true"></i>' : i + 1}</span>${s}</li>`).join("")}</ol>`;
  }

  function itemRow(p) {
    const { esc, rupees, lot, hash } = O();
    const pic = p.image ? `<img src="${esc(p.image)}" alt="">` : window.productArt(p, hash(p.id));
    return `<div class="ask-item"><div class="ask-thumb ${p.image ? "" : "art-bg"}">${pic}</div>
      <div><span class="brand">${esc(p.brand || p.category)}</span><b>${esc(p.name)}</b><span class="mono">${rupees(p.price)} · ${lot(p)}</span></div></div>`;
  }

  function shell(inner) {
    dlg.innerHTML = `<div class="co"><button type="button" class="ask-x" data-close aria-label="Close"><i class="ph ph-x" aria-hidden="true"></i></button>${inner}</div>`;
  }

  // ---------- Step 1: details ----------
  function stepDetails(err = "") {
    const { esc } = O();
    const p = state.p, f = state.form;
    const shipNote = PAY.shippingFee == null ? "Shipping cost is confirmed on WhatsApp before dispatch." : PAY.shippingFee === 0 ? "Free shipping." : `Shipping: ${O().rupees(PAY.shippingFee)}.`;
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
        <button class="order order-now co-cta" type="submit">Continue to payment · ${O().rupees(p.price)}</button>
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
  function stepPay(tab = state.tab || "upi") {
    const { esc, rupees } = O();
    state.tab = tab;
    const o = state.order;
    const note = `${o.code} ${o.lot}`;
    const tabs = [["upi", "UPI", "qr-code"], ["bank", "Bank", "bank"], ["number", "Phone", "phone"]];
    const field = (label, value, mono = true) =>
      `<div class="co-field"><span>${label}</span><b class="${mono ? "mono" : ""}">${esc(value)}</b><button type="button" class="co-copy" data-copy="${esc(value)}" aria-label="Copy ${label}">${COPY}<em>Copy</em></button></div>`;
    let body = "";
    if (tab === "upi") {
      const link = upiLink(o.amount, note);
      const qr = PAY.qrImage ? `<img src="${esc(PAY.qrImage)}" alt="Vibe X payment QR">` : qrSvg(link);
      body = `<div class="co-qr">${qr}<p>Scan with GPay, PhonePe, Paytm or any UPI app.${PAY.qrImage ? ` Enter <b>${rupees(o.amount)}</b>.` : " The amount fills in by itself."}</p></div>
        ${isPhone ? `<a class="btn btn-quiet co-upi" href="${esc(link)}">Open my UPI app <i class="ph ph-arrow-up-right" aria-hidden="true"></i></a>` : ""}
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
      <div class="co-tabs" role="tablist">${tabs.map(([k, l, ic]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${k === tab}"><i class="ph ph-${ic}" aria-hidden="true"></i>${l}</button>`).join("")}</div>
      <div class="co-pay">${body}</div>
      <button type="button" class="order order-now co-cta" data-paid><i class="ph ph-check" aria-hidden="true"></i>I've paid</button>
      <button type="button" class="co-back" data-back>Change details</button>`);
  }

  // ---------- Step 2b: proof ----------
  function stepProof(err = "") {
    const { esc, rupees } = O();
    const o = state.order;
    shell(`${steps(2)}
      <form class="co-form" novalidate>
        <h2>Share the payment</h2>
        <p class="ask-sub">So we can find your ${rupees(o.amount)} quickly. Either one is enough.</p>
        <label>UPI ref / UTR number<input name="utr" inputmode="numeric" maxlength="30" placeholder="12 digit number from your payment app" value="${esc(state.utr || "")}"></label>
        <div class="co-or"><span>or</span></div>
        <label class="co-upload"><input type="file" name="proof" accept="image/*" hidden>
          <span class="co-drop">${state.proof ? `<img src="${state.proof}" alt="Payment screenshot"><em>Change screenshot</em>` : `<b>Upload payment screenshot</b><em>From your gallery</em>`}</span></label>
        <p class="ask-err" role="alert" ${err ? "" : "hidden"}>${esc(err)}</p>
        <button class="order order-now co-cta" type="submit">Send payment details</button>
        <button type="button" class="co-back" data-topay>Back to payment options</button>
      </form>`);
    const form = dlg.querySelector("form");
    form.proof.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      state.utr = form.utr.value;
      state.proof = await shrink(file);
      stepProof();
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      state.utr = form.utr.value;
      const btn = form.querySelector(".co-cta");
      btn.disabled = true;
      btn.textContent = "Sending…";
      try {
        const res = await fetch(`/api/orders/${o.id}/paid`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ utr: state.utr, proof: state.proof }) });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || "Couldn't send. Please try again.");
        stepDone(out.status);
      } catch (ex) {
        stepProof(ex.message);
      }
    });
  }

  // ---------- Step 3: done, with live status ----------
  function stepDone(status) {
    const { esc, rupees } = O();
    const o = state.order, f = state.form;
    const confirmed = status === "confirmed", cancelled = status === "cancelled";
    const when = f.delivery === "ship" ? `We'll ship to ${f.city} and send tracking on WhatsApp.` : "It'll be kept aside for you at the store in Srinagar.";
    shell(`${steps(confirmed ? 4 : 3)}
      <div class="co-done ${confirmed ? "is-ok" : cancelled ? "is-bad" : ""}">
        <span class="co-badge">${confirmed ? '<i class="ph ph-check" aria-hidden="true"></i>' : cancelled ? '<i class="ph ph-warning" aria-hidden="true"></i>' : '<i class="ph ph-clock co-wait" aria-hidden="true"></i>'}</span>
        <p class="mono co-code">Order ${esc(o.code)}</p>
        <h2>${confirmed ? "Order confirmed" : cancelled ? "We couldn't match your payment" : "Payment sent. The piece is held for you."}</h2>
        <p>${confirmed ? `Vibe X received your ${rupees(o.amount)}. ${when}` : cancelled ? "Vibe X will message you on WhatsApp to sort it out." : `Vibe X is checking for your ${rupees(o.amount)}. This page updates by itself, and we'll also WhatsApp you.`}</p>
        <ul class="co-timeline">
          <li class="done">Order placed</li>
          <li class="done">Payment details sent</li>
          <li class="${confirmed ? "done" : cancelled ? "bad" : "now"}">${cancelled ? "Payment not found" : "Vibe X confirms payment"}</li>
          <li class="${confirmed ? "now" : ""}">${f.delivery === "ship" ? "Shipped to you" : "Ready for pickup"}</li>
        </ul>
        <button type="button" class="btn btn-quiet" data-close>Back to the rack</button>
      </div>`);
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

  function shrink(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1400 / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
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
      dlg.addEventListener("close", () => clearInterval(poll));
      dlg.addEventListener("click", (e) => {
        if (e.target === dlg || e.target.closest("[data-close]")) return dlg.close();
        const t = e.target.closest("[data-tab]"); if (t) return stepPay(t.dataset.tab);
        const c = e.target.closest("[data-copy]"); if (c) return copyText(c);
        if (e.target.closest("[data-paid]")) return stepProof();
        if (e.target.closest("[data-topay]")) return stepPay();
        if (e.target.closest("[data-back]")) return stepDetails();
      });
    }
    clearInterval(poll);
    state = { p, form: state && state.form ? { ...state.form } : {}, order: null, tab: "upi", utr: "", proof: null };
    stepDetails();
    dlg.showModal();
  }

  return { open };
})();
