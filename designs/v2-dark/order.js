// Order buttons, shared by the rack (shop.js) and product pages (pdp.js).
// Instagram and WhatsApp can't attach a photo from a link, so the message carries the
// product page's link instead: both apps turn it into a preview card with the photo.
// Instagram also can't pre-type a message, so we copy it and the customer pastes it.
window.VXOrder = (() => {
  const S = window.SHOP;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rupees = (n) => "₹" + Number(n).toLocaleString("en-IN");
  const hash = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const lot = (p) => "Lot " + (p.code || String(hash(p.id) % 9000 + 1000));
  const pageUrl = (p) => `${location.origin}/p/${encodeURIComponent(p.id)}`;
  // ig.me/m/<handle> opens the shop's chat in the Instagram app on phones. On a computer it
  // only lands on the inbox, and Instagram web has no link to one person's chat, so send
  // desktop visitors to the profile, where "Message" is one click away.
  const isPhone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  const igChat = isPhone ? `https://ig.me/m/${S.igHandle}` : `https://www.instagram.com/${S.igHandle}/`;

  const WA = `<i class="ph ph-whatsapp-logo" aria-hidden="true"></i>`;
  const BAG = `<i class="ph ph-shopping-bag" aria-hidden="true"></i>`;
  const IG = `<i class="ph ph-instagram-logo" aria-hidden="true"></i>`;

  function message(p) {
    return `Hi Vibe X! Is this still available?\n${p.name}${p.price ? ` · ${rupees(p.price)}` : ""} · ${lot(p)}\n${pageUrl(p)}`;
  }

  // Primary: "Order now" (checkout with UPI / bank / number).
  // Secondary: "Enquire" (leave your number; the shop gets the photo + your details on WhatsApp).
  // On product pages only: a small "ask on Instagram / chat on WhatsApp" link as a last resort.
  function button(p, big = false) {
    if (p.status === "sold") return `<span class="order is-sold">Sold out</span>`;
    const enquire = `<button type="button" class="enq" data-ask="${esc(p.id)}">${WA}Enquire</button>`;
    if (p.status === "hold") return `<span class="order is-hold">On hold</span>${enquire}`;
    const order = p.price
      ? `<button type="button" class="order order-now" data-order="${esc(p.id)}">${BAG}Order now</button>`
      : `<span class="order is-sold">Price on request</span>`;
    let extra = "";
    if (big) {
      extra = S.whatsapp
        ? `<a class="ask" href="${esc(`https://wa.me/${S.whatsapp}?text=${encodeURIComponent(message(p))}`)}" target="_blank" rel="noopener">or chat with us on WhatsApp</a>`
        : `<a class="ask" href="${esc(igChat)}" target="_blank" rel="noopener" data-ig="${esc(p.id)}">or ask us on Instagram</a>`;
    }
    return `<div class="actions">${order}${enquire}</div>${extra}`;
  }

  let dialog = null;
  function openAsk(p) {
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.className = "ask-dialog";
      document.body.appendChild(dialog);
      dialog.addEventListener("click", (e) => { if (e.target === dialog || e.target.closest("[data-close]")) dialog.close(); });
    }
    const pic = p.image ? `<img src="${esc(p.image)}" alt="">` : window.productArt(p, hash(p.id));
    dialog.innerHTML = `
      <form class="ask-form" novalidate>
        <button type="button" class="ask-x" data-close aria-label="Close"><i class="ph ph-x" aria-hidden="true"></i></button>
        <div class="ask-item"><div class="ask-thumb ${p.image ? "" : "art-bg"}">${pic}</div>
          <div><span class="brand">${esc(p.brand || p.category)}</span><b>${esc(p.name)}</b><span class="mono">${p.price ? rupees(p.price) : "Ask"} · ${lot(p)}</span></div></div>
        <h2>Enquire on WhatsApp</h2>
        <p class="ask-sub">Ask about size, condition or shipping. Leave your number and Vibe X will WhatsApp you, usually within the hour.</p>
        <label>Your name<input name="name" autocomplete="name" maxlength="60" required></label>
        <label>WhatsApp number<div class="ask-phone"><span>+91</span><input name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="98765 43210" maxlength="14" required></div></label>
        <label>Your question <i>(optional)</i><input name="note" maxlength="300" placeholder="e.g. Will it fit size M? Can you ship to Delhi?"></label>
        <input name="website" tabindex="-1" autocomplete="off" class="ask-trap" aria-hidden="true">
        <p class="ask-err" role="alert" hidden></p>
        <button class="order order-now ask-send" type="submit">${WA}Send enquiry</button>
      </form>`;
    const form = dialog.querySelector("form");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = form.querySelector(".ask-err");
      const btn = form.querySelector(".ask-send");
      const data = Object.fromEntries(new FormData(form));
      err.hidden = true;
      btn.disabled = true;
      btn.lastChild.textContent = "Sending…";
      try {
        const res = await fetch("/api/enquiry", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...data, productId: p.id }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || "Couldn't send. Please try again.");
        form.innerHTML = `<button type="button" class="ask-x" data-close aria-label="Close"><i class="ph ph-x" aria-hidden="true"></i></button>
          <div class="ask-done"><span class="ask-tick"><i class="ph ph-check" aria-hidden="true"></i></span><h2>Enquiry sent</h2>
          <p>Vibe X will WhatsApp you at <b>${esc(out.phone || "")}</b> about the ${esc(p.name)}.</p>
          <button type="button" class="btn btn-quiet" data-close>Back to the rack</button></div>`;
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
        btn.disabled = false;
        btn.lastChild.textContent = "Send enquiry";
      }
    });
    dialog.showModal();
    form.querySelector("input[name=name]").focus();
  }

  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(() => true, () => legacyCopy(text));
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
    return ok;
  }

  function toast(html, ms = 5200) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.innerHTML = html;
    t.hidden = false;
    t.style.animation = "none"; void t.offsetWidth; t.style.animation = "";
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (t.hidden = true), ms);
  }

  // getProduct(id) -> product, supplied by the page.
  function install(getProduct) {
    document.addEventListener("click", (e) => {
      const ord = e.target.closest("button[data-order]");
      if (ord) {
        const p = getProduct(ord.dataset.order);
        if (p) window.VXCheckout.open(p);
        return;
      }
      const ask = e.target.closest("button[data-ask]");
      if (ask) {
        const p = getProduct(ask.dataset.ask);
        if (p) openAsk(p);
        return;
      }
      const a = e.target.closest("a[data-ig]");
      if (!a) return;
      const p = getProduct(a.dataset.ig);
      if (!p) return; // let the plain link open the chat
      e.preventDefault();
      // Both steps run inside the tap so the browser allows them.
      const copied = copy(message(p));
      window.open(igChat, "_blank", "noopener");
      copied.then((ok) =>
        toast(ok
          ? `<b>Message copied</b><span>${isPhone ? "Paste it in the Vibe X chat." : "Click <u>Message</u> on our profile, then paste."} The photo shows up as a preview.</span>`
          : `<b>Opening Instagram</b><span>Send us the name: ${esc(p.name)} (${esc(lot(p))}).</span>`)
      );
    });
  }

  return { button, install, toast, lot, rupees, esc, hash, pageUrl };
})();
