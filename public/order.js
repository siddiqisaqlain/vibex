// Order buttons, shared by the rack (shop.js) and product pages (pdp.js).
// Instagram and WhatsApp can't attach a photo from a link, so the message carries the
// product page's link instead: both apps turn it into a preview card with the photo.
// Instagram also can't pre-type a message, so we copy it and the customer pastes it.
window.VXOrder = (() => {
  // First name for the hello on the home page. Letters only: it's shown on the page, and "Mr" or a
  // phone number typed into a name box shouldn't become a greeting.
  function firstName(text) {
    const words = String(text || "").trim().split(/\s+/).filter((w) => !/^(mr|mrs|ms|miss|dr|sir|shri|sri|smt)\.?$/i.test(w));
    const n = words[0] || "";
    if (!/^\p{L}[\p{L}\p{M}'’-]{0,19}$/u.test(n)) return "";
    return n === n.toLowerCase() || n === n.toUpperCase() ? n[0].toUpperCase() + n.slice(1).toLowerCase() : n;
  }
  // After an order, in this browser only. A name the customer already gave us stays as it is.
  function rememberName(full) {
    try { const n = firstName(full); if (n && !localStorage.getItem("vx-name")) localStorage.setItem("vx-name", n); } catch { /* private mode */ }
  }
  // Name, number and address typed into a form, kept in this browser only so nobody types them twice.
  // An autofilled "+91 98765 43210" is trimmed to the ten digits the box expects.
  const DETAILS_KEY = "vx-details", DETAIL_FIELDS = ["name", "phone", "delivery", "address", "city", "pin"];
  function savedDetails() {
    try { const d = JSON.parse(localStorage.getItem(DETAILS_KEY) || "{}"); return d && typeof d === "object" ? d : {}; } catch { return {}; }
  }
  function rememberDetails(d) {
    try {
      const keep = savedDetails();
      for (const k of DETAIL_FIELDS) { const v = String(d[k] ?? "").trim().slice(0, 300); if (v) keep[k] = v; }
      localStorage.setItem(DETAILS_KEY, JSON.stringify(keep));
    } catch { /* private mode */ }
  }
  function forgetDetails() { try { localStorage.removeItem(DETAILS_KEY); } catch { /* private mode */ } }
  function tidyPhone(el) {
    let d = el.value.replace(/\D/g, "");
    if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
    else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
    else return;
    el.value = d;
  }
  // Tidies the number as it arrives and saves what has been typed a moment after the last key.
  function keepDetails(form) {
    let t = null;
    const save = () => rememberDetails(Object.fromEntries(new FormData(form)));
    const on = (e) => { if (e.target.name === "phone") tidyPhone(e.target); clearTimeout(t); t = setTimeout(save, 400); };
    form.addEventListener("input", on);
    form.addEventListener("change", on);
  }
  const S = window.SHOP;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rupees = (n) => "₹" + Number(n).toLocaleString("en-IN");
  const hash = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const lot = (p) => "LOT " + (p.code || String(hash(p.id) % 9000 + 1000));
  const pageUrl = (p) => `${location.origin}/p/${encodeURIComponent(p.id)}`;
  // ig.me/m/<handle> opens the shop's chat in the Instagram app on phones. On a computer it
  // only lands on the inbox, and Instagram web has no link to one person's chat, so send
  // desktop visitors to the profile, where "Message" is one click away.
  const isPhone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  const igChat = isPhone ? `https://ig.me/m/${S.igHandle}` : `https://www.instagram.com/${S.igHandle}/`;

  const WA = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg>`;
  const BAG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 7h12l1 14H5L6 7z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>`;
  const HOLD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="8" cy="8" r="1.6" fill="currentColor"/></svg>`;
  const IG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>`;

  function message(p) {
    return `Hi Vibe X! Is this still available?\n${p.name}${p.price ? ` · ${rupees(p.price)}` : ""} · ${lot(p)}\n${pageUrl(p)}`;
  }

  // Primary: "Order now" (checkout with UPI / bank / number).
  // Secondary: "Enquire" (leave your number; the shop gets the photo + your details on WhatsApp).
  // On product pages only: a small "ask on Instagram / chat on WhatsApp" link as a last resort.
  // Product pages only. A card on the rack is its photo, name and price, like an Instagram grid (2026-11-11):
  // a tap opens the product page, and the buttons live there.
  function button(p, big = false) {
    if (p.status === "sold") return `<span class="order is-sold">Sold out</span>`;
    const enquire = `<button type="button" class="enq" data-ask="${esc(p.id)}" aria-label="Ask on WhatsApp">${WA}Enquire</button>`;
    if (p.status === "hold") return `<span class="order is-hold">On hold</span>${enquire}`;
    // Online ordering stays off until the shop's real payment details are in shop.json.
    const order = S.orderingOpen === false ? ""
      : p.price
      ? `<button type="button" class="order order-now" data-order="${esc(p.id)}">${BAG}Add to bag</button>`
      : `<span class="order is-sold">Price on request</span>`;
    let extra = "";
    // Wishlist heart, on product pages (lib: bag.js keeps the list).
    const heart = big && window.VXBag ? `<button type="button" class="vx-wish" data-wish="${esc(p.id)}" aria-pressed="false" aria-label="Save to wishlist"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.6 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.4 0 5.6 3.4 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"/></svg></button>` : "";
    if (big) {
      extra = S.whatsapp
        ? `<a class="ask" href="${esc(`https://wa.me/${S.whatsapp}?text=${encodeURIComponent(message(p))}`)}" target="_blank" rel="noopener">or chat with us on WhatsApp</a>`
        : `<a class="ask" href="${esc(igChat)}" target="_blank" rel="noopener" data-ig="${esc(p.id)}">or ask us on Instagram</a>`;
    }
    return `<div class="actions">${order}${enquire}${heart}</div>${extra}`;
  }

  // ---- Add to bag straight from the rack (2026-11-11) ----
  // A small bag button in the corner of a card's photo. One tap adds the piece without leaving the rack;
  // a piece with several sizes slides up its sizes first. The card itself stays photo, name and price.
  const TICK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
  const BAG_PLUS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8h12l1 13H5L6 8z"/><path d="M9 8a3 3 0 0 1 6 0"/><path d="M12 12v5M9.5 14.5h5"/></svg>`;
  function quick(p) {
    if (S.orderingOpen === false || p.status !== "available" || !p.price || !window.VXBag) return "";
    const inBag = window.VXBag.bag().some((l) => l.id === p.id);
    return `<button type="button" class="vx-quick${inBag ? " in" : ""}" data-quick="${esc(p.id)}" aria-label="${inBag ? "In your bag: " : "Add to bag: "}${esc(p.name)}"><span class="q-add">${BAG_PLUS}</span><span class="q-in">${TICK}</span></button>`;
  }
  const multiPrice = (p) => new Set((p.options || []).map((o) => o.price)).size > 1;
  let sizes = null, sizesFor = null;
  function openSizes(p, getProduct) {
    if (!sizes) {
      sizes = document.createElement("dialog");
      sizes.className = "ask-dialog vx-sheet vx-sizes";
      document.body.appendChild(sizes);
      sizes.addEventListener("click", (e) => {
        if (e.target === sizes || e.target.closest("[data-close]")) return sizes.close();
        const b = e.target.closest("[data-qsize]"); // not data-size: on the home page that is the rack's size filter
        e.stopPropagation();
        if (!b) return;
        const now = sizesFor.get(sizesFor.id), o = now?.status === "available" && (now.options || []).find((x) => x.size === b.dataset.qsize && x.left !== 0);
        sizes.close();
        if (o) place({ ...now, price: o.price, sizes: o.size, chosenSize: o.size }, "rack"); // else it sold while the sheet was open
      });
    }
    sizesFor = { id: p.id, get: getProduct };
    const left = (o) => (o.left === 0 ? "Sold out" : o.left === 1 ? "Last one" : o.left <= 3 ? `${o.left} left` : multiPrice(p) ? "" : "In stock");
    const pic = p.image ? `<img src="${esc(p.image)}" alt="">` : window.productArt(p, hash(p.id));
    sizes.innerHTML = `<div class="co">
      <button type="button" class="ask-x" data-close aria-label="Close">×</button>
      <div class="ask-item"><div class="ask-thumb ${p.image ? "" : "art-bg"}">${pic}</div>
        <div><span class="brand">${esc(p.brand || p.category)}</span><b>${esc(p.name)}</b><span class="mono">${multiPrice(p) ? "From " : ""}${rupees(p.price)}</span></div></div>
      <h2>Select size</h2>
      <div class="vx-size-grid" role="group" aria-label="Select size">${p.options.map((o) => `<button type="button" class="vx-size" data-qsize="${esc(o.size)}" ${o.left === 0 ? "disabled" : ""}><b>${esc(o.size)}</b>${multiPrice(p) && o.left !== 0 ? `<span>${rupees(o.price)}</span>` : ""}${left(o) ? `<span class="${o.left >= 1 && o.left <= 3 ? "low" : ""}">${left(o)}</span>` : ""}</button>`).join("")}</div>
      <p class="co-small">Tap your size and it goes in your bag.</p>
      <a class="pdp-size-help" href="${esc(pageUrl(p))}">See all photos and details</a>
    </div>`;
    sizes.showModal();
    window.VXTrack?.("size_sheet", { pr: p.id });
  }
  function quickAdd(p, getProduct) {
    if (window.VXBag.bag().some((l) => l.id === p.id)) return window.VXBag.openSheet(); // already in: show the bag
    const opts = (p.options || []).filter((o) => o.left !== 0);
    if ((p.options || []).length > 1) return openSizes(p, getProduct);
    const o = opts[0];
    place(o ? { ...p, price: o.price, sizes: o.size, chosenSize: o.size } : p, "rack");
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
    const mine = savedDetails();
    dialog.innerHTML = `
      <form class="ask-form" novalidate>
        <button type="button" class="ask-x" data-close aria-label="Close">×</button>
        <div class="ask-item"><div class="ask-thumb ${p.image ? "" : "art-bg"}">${pic}</div>
          <div><span class="brand">${esc(p.brand || p.category)}</span><b>${esc(p.name)}</b><span class="mono">${p.price ? rupees(p.price) : "Ask"} · ${lot(p)}</span></div></div>
        <h2>Enquire on WhatsApp</h2>
        <p class="ask-sub">Ask about size, condition or shipping. Leave your number and Vibe X will WhatsApp you, usually within the hour.</p>
        <label>Your name<input name="name" autocomplete="name" maxlength="60" value="${esc(mine.name || "")}" required></label>
        <label>WhatsApp number<div class="ask-phone"><span>+91</span><input name="phone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="98765 43210" maxlength="20" value="${esc(mine.phone || "")}" required></div></label>
        <label>Your question <i>(optional)</i><input name="note" maxlength="300" placeholder="e.g. Will it fit size M? Can you ship to Delhi?"></label>
        <input name="website" tabindex="-1" autocomplete="off" class="ask-trap" aria-hidden="true">
        <p class="ask-err" role="alert" hidden></p>
        <button class="order ask-send" type="submit">${WA}Send enquiry</button>
        <p class="consent">We use your name and number only to reply about this piece. They are also kept on this device, so you don't type them next time. <a href="/privacy" target="_blank" rel="noopener">Privacy policy</a></p>
      </form>`;
    const form = dialog.querySelector("form");
    keepDetails(form);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      tidyPhone(form.elements.phone);
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
        window.VXTrack?.("enq", { pr: p.id });
        form.innerHTML = `<button type="button" class="ask-x" data-close aria-label="Close">×</button>
          <div class="ask-done"><span class="ask-tick">✓</span><h2>Enquiry sent</h2>
          <p>Vibe X will WhatsApp you at <b>${esc(out.phone || "")}</b> about the ${esc(p.name)}.</p>
          <button type="button" class="btn btn-ink" data-close>Back to the rack</button></div>`;
      } catch (ex) {
        window.VXTrack?.("formerr", { x: ex.message });
        err.textContent = ex.message;
        err.hidden = false;
        btn.disabled = false;
        btn.lastChild.textContent = "Send enquiry";
      }
    });
    dialog.showModal();
    form.querySelector(mine.name && mine.phone ? "input[name=note]" : mine.name ? "input[name=phone]" : "input[name=name]").focus();
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

  const place = (p, from) => (window.VXBag ? window.VXBag.add(p, from) : window.VXCheckout.open(p));

  // getProduct(id) -> product, supplied by the page. forOrder(id) -> the product as ordered
  // (with its size), or nothing if the customer still has to choose.
  function install(getProduct, forOrder = getProduct) {
    document.addEventListener("click", (e) => {
      const q = e.target.closest("button[data-quick]");
      if (q) { e.preventDefault(); const p = getProduct(q.dataset.quick); if (p) quickAdd(p, getProduct); return; }
      const ord = e.target.closest("button[data-order]");
      if (ord) {
        const p = forOrder(ord.dataset.order);
        if (p) place(p);
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

  return { firstName, rememberName, savedDetails, rememberDetails, forgetDetails, keepDetails, tidyPhone, button, quick, install, place, toast, lot, rupees, esc, hash, pageUrl };
})();
