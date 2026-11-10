// Product page: /p/<id>. The server already put the share-preview tags in <head>;
// this draws the page itself and keeps it current if the item sells.
(() => {
  const O = window.VXOrder;
  const { esc, rupees, lot, hash } = O;
  const BASE = window.VX_BASE || ""; // "/preview/<name>" when shown as a hidden preview
  const root = document.getElementById("pdp");
  const id = root.dataset.id;
  let products = [];
  let pick = null, needPick = false; // chosen size; true after "Order now" with none chosen
  let shot = 0; // which of the item's photos is showing

  // A WhatsApp chat with the shop, the message already written. From the analytics (2026-11-09): people open a
  // jacket and leave within 5 seconds, so the page answers the doubts they'd otherwise have to ask about.
  const waLink = (text) => window.SHOP?.whatsapp ? `https://wa.me/${window.SHOP.whatsapp}?text=${encodeURIComponent(text)}` : "";
  const sizeTxt = (p) => { const c = chosenOf(p)?.size; return c && optionsOf(p).length > 1 ? ` in size ${c}` : ""; };
  function trust(p) {
    if (p.status !== "available") return "";
    const maps = window.SHOP?.maps;
    return `<ul class="pdp-trust" aria-label="Why buy here">
      <li><span aria-hidden="true">✓</span><span><b>100% original</b> or your money back</span></li>
      <li><span aria-hidden="true">📍</span><span><b>Try it on</b> at our Khanyaar store${maps ? ` · <a href="${esc(maps)}" target="_blank" rel="noopener">Directions</a>` : ""}</span></li>
      <li><span aria-hidden="true">🚚</span><span><b>Ships anywhere</b> in India · or pick up in Srinagar</span></li>
    </ul>`;
  }
  // Only the brand's catalogue shot: offer real photos of the exact piece, which is what a stranger wants to see.
  function realPhotos(p) {
    const link = waLink(`Hi Vibe X, can you send me real photos of ${p.name}${sizeTxt(p)}? (${lot(p)})`);
    if (!link || p.status !== "available" || photosOf(p).length > 1) return "";
    return `<a class="pdp-real" href="${esc(link)}" target="_blank" rel="noopener" data-real="${esc(p.id)}"><span aria-hidden="true">📸</span><span><b>See real photos of this piece</b>Ask on WhatsApp and we'll send them</span><i aria-hidden="true">→</i></a>`;
  }

  const offPct = (p) => (p.mrp && p.price && p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0);

  function media(p) {
    const pic = p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}">` : window.productArt(p, hash(p.id));
    return `<div class="media ${p.image ? "" : "art-bg"}">${pic}<span class="lot">${lot(p)}</span>
      ${p.status === "sold" ? `<div class="sold-stamp"><span>SOLD</span></div>` : ""}
      ${p.status === "hold" ? `<div class="sold-stamp hold-stamp"><span>ON HOLD</span></div>` : ""}</div>`;
  }

  // The big photo, with a row of small ones when the item has more than one.
  const photosOf = (p) => [p.image, ...(p.images || [])].filter(Boolean);
  function gallery(p) {
    const list = photosOf(p);
    if (list.length < 2) return media(p);
    if (shot >= list.length) shot = 0;
    return `${media({ ...p, image: list[shot] })}
      <div class="pdp-thumbs" role="group" aria-label="More photos of ${esc(p.name)}">${list.map((u, i) => `<button type="button" data-shot="${i}" class="${i === shot ? "on" : ""}" aria-label="Photo ${i + 1} of ${list.length}" aria-pressed="${i === shot}"><img src="${esc(u)}" alt="" decoding="async"></button>`).join("")}</div>`;
  }

  function mini(p) {
    return `<a class="mini" href="${BASE}/p/${encodeURIComponent(p.id)}">${media(p)}
      <span class="brand">${esc(p.brand || p.category)}</span><b>${esc(p.name)}</b><span class="mono">${p.price ? rupees(p.price) : "Ask"}</span></a>`;
  }

  const optionsOf = (p) => p.options || [];
  // The smallest size in stock is chosen to start with (decided 2026-11-10): S before M before L,
  // 50 ml before 100 ml. The customer can tap another size; their tap always wins.
  const LETTER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "4XL", "5XL"];
  const sizeRank = (size, i) => {
    const t = String(size).toUpperCase().replace(/\s+/g, "");
    const k = LETTER.indexOf({ "2XL": "XXL", "3XL": "XXXL" }[t] || t);
    if (k >= 0) return 1e6 + k;                                  // S, M, L, XL, 2XL...
    const n = /^(\d+(?:\.\d+)?)/.exec(t);
    return n ? Number(n[1]) : 2e6 + i;                           // 50 ml, 100ml, 32, 9.5; anything else keeps its order
  };
  const smallestOf = (list) => list.map((o, i) => ({ o, r: sizeRank(o.size, i) })).sort((a, b) => a.r - b.r)[0]?.o || null;
  const chosenOf = (p) => { const o = optionsOf(p).filter((x) => x.left !== 0); return o.find((x) => x.size === pick) || smallestOf(o); };
  const multiPrice = (p) => new Set(optionsOf(p).map((o) => o.price)).size > 1;

  function sizePicker(p) {
    const opts = optionsOf(p);
    if (opts.length < 2 || p.status !== "available") return "";
    const on = chosenOf(p)?.size;
    const label = (o) => esc(o.size) + (o.left === 0 ? " · sold out" : multiPrice(p) ? ` · ${rupees(o.price)}` : "");
    return `<div class="pdp-sizes" role="group" aria-label="Choose size">
        <div class="pdp-size-head"><p class="label">Choose size</p>${waLink("x") ? `<a class="pdp-size-help" href="${esc(waLink(`Hi Vibe X, what are the chest and length measurements of ${p.name}${sizeTxt(p)}? (${lot(p)})`))}" target="_blank" rel="noopener" data-sizehelp="${esc(p.id)}">Not sure? Get measurements</a>` : ""}</div>
        <div class="pills">${opts.map((o) => `<button type="button" class="pill${o.size === on ? " on" : ""}" data-pick="${esc(o.size)}" aria-pressed="${o.size === on}" ${o.left === 0 ? "disabled" : ""}>${label(o)}</button>`).join("")}</div>
        ${needPick ? `<p class="ask-err" role="alert">Choose your size to order</p>` : ""}
      </div>`;
  }

  // The shop's promise, beside the button where the doubt is. Every line is read from the policy in shop.json, says the
  // same as the returns page, and keeps its conditions. It changes no price. 15% of visitors don't see it, so its effect can be measured.
  const P = window.SHOP?.policy || {};
  const showPromise = () => window.VXVisit?.arm !== "off";
  let promiseCounted = false;
  function countPromise() {
    if (promiseCounted || !window.VXTrack) return;
    promiseCounted = true;
    window.VXTrack("nudge", { x: "promise", ...(showPromise() ? {} : { ctl: 1 }) });
  }
  function arrives() { // working days skip Sundays; an estimate, and worded as one
    const [lo, hi] = (String(P.deliveryDays || "").match(/\d+/g) || []).map(Number);
    if (!P.dispatchWorkingDays || !lo) return "";
    const d = new Date();
    for (let n = P.dispatchWorkingDays; n > 0;) { d.setDate(d.getDate() + 1); if (d.getDay()) n--; }
    const day = (add) => new Date(d.getTime() + add * 864e5).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    return `Order today and it usually reaches you between ${day(lo)} and ${day(hi || lo)}.`;
  }
  function promise(p) {
    if (p.status !== "available" || !showPromise()) return "";
    const fragrance = p.category === "Fragrances", days = P.changeOfMindDays;
    const lines = [
      ["Real, or your money back", "If it ever turns out not to be genuine, you get a full refund, including shipping, whenever you find out."],
      P.photoBeforeDispatch && ["See it before it leaves", "We send you a photo of your exact piece on WhatsApp before dispatch."],
      days && (fragrance ? [`${days} days to return it`, "As long as the seal is unbroken. You pay the return shipping."] : [`${days} days to change your mind`, "Unused, unwashed, tags on. You pay the return shipping."]),
      P.damageReportHours && ["Wrong or damaged", `Tell us within ${P.damageReportHours} hours with photos. We replace it or refund you, including shipping.`],
      ["Cancel before dispatch", "Full refund."],
    ].filter(Boolean);
    const when = arrives();
    return `<section class="vx-promise" aria-label="The Vibe X promise" data-vx-skip>
      <h2>The Vibe X promise</h2>
      <ul>${lines.map(([a, b]) => `<li><b>${esc(a)}</b><span>${esc(b)}</span></li>`).join("")}</ul>
      ${when ? `<p>${esc(when)}</p>` : ""}
      <a href="/returns" target="_blank" rel="noopener">Read the full returns policy</a>
    </section>`;
  }

  function render() {
    const p = products.find((x) => x.id === id);
    if (!p) {
      root.innerHTML = `<div class="pdp-gone"><h1>This piece has left the rack.</h1><p>It was sold or taken down. New stock lands most days.</p><a class="btn btn-ink" href="${BASE}/#rack">See today's drops</a></div>`;
      return;
    }
    const chosen = chosenOf(p);
    const price = chosen?.price ?? p.price;
    const from = !chosen && multiPrice(p);
    const off = from ? 0 : offPct({ ...p, price });
    const related = products.filter((x) => x.id !== p.id && x.category === p.category && x.status === "available").slice(0, 4);
    root.innerHTML = `
      <a class="back mono" href="${BASE}/#rack">← Back to the rack</a>
      <div class="pdp-grid">
        <div class="pdp-media">${gallery(p)}${realPhotos(p)}</div>
        <div class="pdp-info">
          <p class="label">${esc([p.category, p.subcategory].filter(Boolean).join(" › "))}</p>
          ${p.brand ? `<span class="brand">${esc(p.brand)}</span>` : ""}
          <h1>${esc(p.name)}</h1>
          <div class="pdp-price">
            <b>${price ? `${from ? "From " : ""}${rupees(price)}` : "Ask for price"}</b>
            ${off ? `<s>${rupees(p.mrp)}</s><span class="off">${off}% OFF</span>` : ""}
            ${off && showPromise() ? `<span class="pdp-save">You save ${rupees(p.mrp - price)}</span>` : ""}
          </div>
          ${sizePicker(p)}
          ${trust(p)}
          <p class="pdp-desc">${esc(p.description)}</p>
          <dl class="pdp-facts">
            ${p.sizes && (optionsOf(p).length < 2 || p.status !== "available") ? `<div><dt>Size</dt><dd>${esc(p.sizes)}</dd></div>` : ""}
            <div><dt>Condition</dt><dd>Original</dd></div>
            <div><dt>In stock</dt><dd>${p.status === "sold" ? "Sold out" : p.status === "hold" ? "On hold for a buyer" : p.quantity > 1 ? `${p.quantity} pieces` : "Last one"}</dd></div>
            <div><dt>Get it</dt><dd>Pick up in Srinagar or ship anywhere in India${P.courier?.perKg ? `. Courier is ${rupees(P.courier.perKg)} per kg outside Kashmir` : ""}</dd></div>
          </dl>
          ${O.button(p, true)}
          ${promise(p)}
        </div>
      </div>
      ${related.length ? `<section class="related"><h2>More ${esc(p.category.toLowerCase())}</h2><div class="related-row">${related.map(mini).join("")}</div></section>` : ""}`;
    if (p.status === "available") countPromise();
    // The full promise sits below the fold, so its first line goes where the thumb is.
    // On a phone the price can sit below the first screen, so it rides on the button too (shop.css).
    if (price && !from) root.querySelector(".pdp-info .order-now")?.insertAdjacentHTML("beforeend", `<span class="order-price"> · ${rupees(price)}</span>`);
    if (root.querySelector(".vx-promise")) root.querySelector(".pdp-info .actions")?.insertAdjacentHTML("afterbegin", `<button type="button" class="vx-sure" data-promise>Real, or your money back${P.changeOfMindDays ? ` · ${esc(P.changeOfMindDays)}-day returns` : ""}</button>`);
  }

  let lastJson = "";
  async function load() {
    try {
      const res = await fetch("/api/products", { cache: "no-store" });
      const json = await res.text();
      if (json === lastJson) return; // redrawing would swallow a tap landing at that moment
      lastJson = json;
      products = JSON.parse(json);
      render();
    } catch { /* keep what's on screen */ }
  }

  // People kept tapping the photo: open it full screen, where a phone can pinch in on it.
  function zoom(img) {
    const box = document.createElement("dialog");
    box.className = "pdp-zoom";
    box.innerHTML = `<img alt=""><button type="button" aria-label="Close photo">×</button>`;
    box.querySelector("img").src = img.src; box.querySelector("img").alt = img.alt;
    box.addEventListener("click", () => box.close());
    box.addEventListener("close", () => box.remove());
    document.body.append(box);
    box.showModal();
  }

  root.addEventListener("click", (e) => {
    const thumb = e.target.closest("[data-shot]");
    if (thumb) { shot = Number(thumb.dataset.shot); return render(); }
    const photo = e.target.closest(".pdp-media .media img");
    if (photo) return zoom(photo);
    if (e.target.closest(".vx-promise a")) window.VXTrack?.("nudge_tap", { x: "promise" });
    if (e.target.closest("[data-promise]")) { window.VXTrack?.("nudge_tap", { x: "promise" }); root.querySelector(".vx-promise")?.scrollIntoView({ block: "center", behavior: "smooth" }); return; }
    const b = e.target.closest("[data-pick]");
    if (!b) return;
    pick = b.dataset.pick;
    needPick = false;
    render();
  });

  // Swiping the big photo moves through the item's photos.
  let swipeX = null;
  root.addEventListener("touchstart", (e) => { swipeX = e.target.closest(".pdp-media .media") && e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
  root.addEventListener("touchend", (e) => {
    if (swipeX === null) return;
    const moved = e.changedTouches[0].clientX - swipeX, p = products.find((x) => x.id === id), n = p ? photosOf(p).length : 0;
    swipeX = null;
    if (n < 2 || Math.abs(moved) < 40) return;
    shot = (shot + (moved < 0 ? 1 : n - 1)) % n;
    render();
  }, { passive: true });

  O.install((pid) => products.find((p) => p.id === pid), (pid) => {
    const p = products.find((x) => x.id === pid);
    if (!p) return null;
    const chosen = chosenOf(p);
    if (optionsOf(p).length > 1 && !chosen) {
      needPick = true;
      render();
      // Added here, not in render(): the 5-second refresh would replay the jiggle otherwise.
      root.querySelector(".pdp-info .order-now")?.classList.add("nudge");
      const sizes = root.querySelector(".pdp-sizes");
      sizes?.classList.add("nudge");
      const box = sizes?.getBoundingClientRect();
      if (box && (box.top < 80 || box.bottom > innerHeight - 100)) sizes.scrollIntoView({ block: "center", behavior: "smooth" });
      return null;
    }
    return chosen ? { ...p, price: chosen.price, sizes: chosen.size, chosenSize: chosen.size } : p;
  });
  load();
  setInterval(() => { if (!document.hidden) load(); }, 5000);
})();
