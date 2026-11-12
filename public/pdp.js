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
  let drag = null, swiped = 0; // a swipe on the photos in progress; when the last one ended

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

  function media(p, extra = "") {
    const pic = p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}">` : window.productArt(p, hash(p.id));
    return `<div class="media ${p.image ? "" : "art-bg"}">${pic}<span class="lot">${lot(p)}</span>${extra}
      ${p.status === "sold" ? `<div class="sold-stamp"><span>SOLD</span></div>` : ""}
      ${p.status === "hold" ? `<div class="sold-stamp hold-stamp"><span>ON HOLD</span></div>` : ""}</div>`;
  }

  // Every photo of the item in one strip: swipe on a phone (dots and 1/4), small photos and arrows
  // on a computer, arrow keys, tap to zoom. Photos whose file is missing are left out.
  const broken = new Set();
  const photosOf = (p) => [p.image, ...(p.images || [])].filter((u) => u && !broken.has(u));
  function gallery(p) {
    const list = photosOf(p), n = list.length;
    if (n < 2) return media({ ...p, image: list[0] || null });
    if (shot >= n) shot = 0;
    return `<div class="media pdp-gal" role="region" aria-roledescription="carousel" aria-label="Photos of ${esc(p.name)}">
        <div class="pdp-track" style="transform:translateX(${-shot * 100}%)">${list.map((u, i) => `<img src="${esc(u)}" alt="${esc(p.name)}, photo ${i + 1} of ${n}" width="800" height="1000" decoding="async" draggable="false"${Math.abs(i - shot) <= 1 ? "" : ` loading="lazy"`}>`).join("")}</div>
        <span class="lot">${lot(p)}</span>
        ${p.status === "sold" ? `<div class="sold-stamp"><span>SOLD</span></div>` : ""}
        ${p.status === "hold" ? `<div class="sold-stamp hold-stamp"><span>ON HOLD</span></div>` : ""}
        <button type="button" class="pdp-arrow prev" data-step="-1" aria-label="Previous photo">‹</button><button type="button" class="pdp-arrow next" data-step="1" aria-label="Next photo">›</button>
        <span class="pdp-count" aria-live="polite">${shot + 1}/${n}</span>
        <span class="pdp-dots" aria-hidden="true">${list.map((_, i) => `<i class="${i === shot ? "on" : ""}"></i>`).join("")}</span>
      </div>
      <div class="pdp-thumbs" role="group" aria-label="More photos of ${esc(p.name)}">${list.map((u, i) => `<button type="button" data-shot="${i}" class="${i === shot ? "on" : ""}" aria-label="Photo ${i + 1} of ${n}" aria-pressed="${i === shot}"><img src="${esc(u)}" alt="" width="64" height="64" loading="lazy" decoding="async"></button>`).join("")}</div>`;
  }
  // Shows photo i without redrawing the page.
  function go(i, glide = true) {
    const gal = root.querySelector(".pdp-gal");
    if (!gal) return;
    const imgs = gal.querySelectorAll(".pdp-track img"), n = imgs.length;
    shot = ((i % n) + n) % n;
    const track = gal.querySelector(".pdp-track");
    track.classList.toggle("glide", glide);
    track.style.transform = `translateX(${-shot * 100}%)`;
    for (const k of [shot - 1, shot, shot + 1]) imgs[(k + n) % n].removeAttribute("loading"); // the next ones load before they're needed
    gal.querySelector(".pdp-count").textContent = `${shot + 1}/${n}`;
    gal.querySelectorAll(".pdp-dots i").forEach((d, k) => d.classList.toggle("on", k === shot));
    root.querySelectorAll(".pdp-thumbs [data-shot]").forEach((b, k) => { b.classList.toggle("on", k === shot); b.setAttribute("aria-pressed", String(k === shot)); });
  }

  function mini(p) {
    return `<a class="mini" href="${BASE}/p/${encodeURIComponent(p.id)}"${window.VXPhotos?.alt(p) || ""}>${media(p, window.VXPhotos?.badge(p) || "")}
      <span class="brand">${esc(p.brand || p.category)}</span><b>${esc(p.name)}</b><span class="mono">${p.price ? rupees(p.price) : "Ask"}</span></a>`;
  }

  // ---- Start small (2026-11-12): on a costly piece, a nervous first-time buyer gets a cheap way to try the shop.
  // Sweaters at ₹799 went into the bag about five times as often as the ₹6,600 jackets most visitors land on.
  const COSTLY = 3000, SMALL = 2000;
  function starter(p, all) {
    if (!(p.price >= COSTLY)) return "";
    const seen = new Set(), pick = [];
    const cheap = all.filter((x) => x.id !== p.id && x.status === "available" && x.price > 0 && x.price <= SMALL && x.image).sort((a, b) => a.price - b.price);
    // one of each look first, so the row isn't four of the same sweater
    for (const x of cheap) { const k = `${x.category}|${String(x.name).toLowerCase().replace(/\s*·.*$/, "").trim()}|${x.sizes || ""}`; if (seen.has(k)) continue; seen.add(k); pick.push(x); }
    const own = pick.filter((x) => x.category === p.category).slice(0, 3), other = pick.filter((x) => x.category !== p.category).slice(0, 4 - own.length), row = [...own, ...other].slice(0, 4);
    if (row.length < 2) return "";
    return `<section class="related pdp-start"><h2>New here? Start small.</h2><p class="pdp-start-say">Try us with something from ${rupees(row[0].price)}. Same shop, same originals, same 7-day returns.</p><div class="related-row">${row.map(mini).join("")}</div></section>`;
  }

  const optionsOf = (p) => p.options || [];
  // ---- Size guides (2026-11-11): each brand's own chart, read off the brand's India site, shown on its pieces.
  // `body` charts say who a size is made for; `garment` charts are the piece laid flat and measured.
  // Inches first (the shop measures chest in inches), centimetres after. Never the shop's stock: that is p.sizes.
  const GUIDES = [
    { test: /\buspa\b|u\.?\s?s\.?\s?polo/i, title: "U.S. Polo Assn. sweaters", kind: "garment", source: "uspoloassn.in",
      cols: ["Chest", "Length", "Shoulder"],
      rows: [["S", "39.5 in (100 cm)", "29 in (74 cm)", "17 in (43 cm)"], ["M", "41.5 in (105 cm)", "29.5 in (75 cm)", "18 in (46 cm)"], ["L", "45 in (114 cm)", "31 in (79 cm)", "19 in (48 cm)"], ["XL", "47.5 in (121 cm)", "31.5 in (80 cm)", "20 in (51 cm)"], ["XXL", "50 in (127 cm)", "32 in (81 cm)", "21 in (53 cm)"]] },
    { test: /\bcolumbia\b/i, title: "Columbia men's jackets", kind: "body", source: "columbiasportswear.co.in",
      cols: ["Chest", "Waist", "Hip"],
      rows: [["S", "35.5 in (90 cm)", "30 in (76 cm)", "36 in (91 cm)"], ["M", "37.5 in (95 cm)", "32 in (81 cm)", "38 in (96.5 cm)"], ["L", "39.5 in (100 cm)", "34 in (86 cm)", "39.75 in (101 cm)"], ["XL", "41.5 in (105 cm)", "36 in (91 cm)", "42 in (106.5 cm)"]] },
    { test: /\bpuma\b/i, title: "Puma men's jackets", kind: "body", source: "in.puma.com",
      cols: ["Chest", "Waist", "Hip"],
      rows: [["S", "35 to 38 in", "30 to 33 in", "35 to 37 in"], ["M", "38 to 41 in", "33 to 36 in", "38 to 40 in"], ["L", "41 to 45 in", "36 to 39 in", "41 to 44 in"], ["XL", "45 to 48 in", "40 to 43 in", "44 to 48 in"]] },
  ];
  // The shop writes sizes as "M", "m" or "M · 42": the chart matches on the first word, and 2XL is XXL.
  const sizeKey = (s) => { const k = String(s || "").toUpperCase().trim().split(/[^A-Z0-9]+/)[0]; return { "2XL": "XXL", "3XL": "XXXL" }[k] || k; };
  // The piece in the size a chart row names: one of its sizes, or the piece itself when it comes in a single size.
  function chartOption(p, size) {
    const k = sizeKey(size), opts = optionsOf(p);
    if (opts.length) return opts.find((o) => sizeKey(o.size) === k) || null;
    return p.sizes && sizeKey(p.sizes) === k ? { size: p.sizes, price: p.price } : null;
  }
  root.addEventListener("click", (e) => {
    const row = e.target.closest?.(".pdp-guide tr[data-gsize]");
    if (!row) return;
    const now = products.find((x) => x.id === id);
    if (!now) return;
    const size = row.dataset.gsize, o = chartOption(now, size);
    // Only sizes the chart itself lists are named back, so a stray chest number saved as a size is not offered.
    const onChart = new Set([...row.parentElement.querySelectorAll("tr[data-gsize]")].map((r) => sizeKey(r.dataset.gsize)));
    const inStock = optionsOf(now).filter((x) => x.left !== 0 && onChart.has(sizeKey(x.size))).map((x) => x.size);
    window.VXTrack?.("chart_size", { pr: now.id, size, ok: Boolean(o && o.left !== 0 && now.status === "available") });
    if (!o || o.left === 0 || now.status !== "available") {
      const others = now.status === "available" && inStock.length ? ` In stock: ${inStock.map(esc).join(", ")}.` : "";
      return O.toast(`<b>Size ${esc(size)} is not available</b><span>${o ? "It is sold out in this piece." : "We do not have this piece in that size."}${others}</span>`);
    }
    const old = document.getElementById("toast"); if (old) old.hidden = true; // an earlier "not available" must not sit over the add
    pick = o.size; needPick = false;
    render();
    O.place({ ...now, price: o.price, sizes: o.size, chosenSize: o.size });
  });
  function sizeGuide(p) {
    if (p.category !== "Clothing") return "";
    const g = GUIDES.find((x) => x.test.test(`${p.brand || ""} ${p.name || ""}`));
    if (!g) return "";
    // A row can be tapped (2026-11-12): a size the shop has goes in the bag, one it does not have says so.
    const state = (size) => { const o = chartOption(p, size); return !o ? "none" : o.left === 0 || p.status !== "available" ? "out" : "have"; };
    const word = { have: "Add to bag", out: "Sold out", none: "Not in stock" };
    return `<details class="pdp-guide"><summary>Size chart</summary>
        <p class="pdp-guide-what">${esc(g.title)}. ${g.kind === "body" ? "Your own body measurements: pick the size whose chest matches yours." : "The sweater itself, measured flat: compare with one you own."}</p>
        <p class="pdp-guide-tap">Tap a size to add it to your bag.</p>
        <div class="pdp-guide-scroll"><table><thead><tr><th>Size</th>${g.cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
        <tbody>${g.rows.map((r) => { const s = state(r[0]); return `<tr class="${s}" data-gsize="${esc(r[0])}"><th><button type="button" class="pdp-guide-pick" aria-label="Size ${esc(r[0])}: ${word[s]}">${esc(r[0])}</button><small>${word[s]}</small></th>${r.slice(1).map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`; }).join("")}</tbody></table></div>
        <p class="pdp-guide-src">From the brand's own size chart (${esc(g.source)}).${g.kind === "garment" ? " A piece can differ by about half an inch." : ""}</p>
      </details>`;
  }

  // With several sizes nothing is chosen for them (2026-11-11): "Add to bag" asks for the size in a sheet,
  // so nobody bags the wrong one without noticing. A piece with one size has it chosen already.
  const LETTER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "4XL", "5XL"];
  const sizeRank = (size, i) => {
    const t = String(size).toUpperCase().replace(/\s+/g, "");
    const k = LETTER.indexOf({ "2XL": "XXL", "3XL": "XXXL" }[t] || t);
    if (k >= 0) return 1e6 + k;                                  // S, M, L, XL, 2XL...
    const n = /^(\d+(?:\.\d+)?)/.exec(t);
    return n ? Number(n[1]) : 2e6 + i;                           // 50 ml, 100ml, 32, 9.5; anything else keeps its order
  };
  const smallestOf = (list) => list.map((o, i) => ({ o, r: sizeRank(o.size, i) })).sort((a, b) => a.r - b.r)[0]?.o || null;
  const chosenOf = (p) => { const o = optionsOf(p).filter((x) => x.left !== 0); return o.find((x) => x.size === pick) || (optionsOf(p).length > 1 ? null : smallestOf(o)); };
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

  // "Add to bag" with no size chosen slides the sizes up, and a tap on one adds that size.
  let sheet = null;
  function openSizes(p) {
    if (!sheet) {
      sheet = document.createElement("dialog");
      sheet.className = "ask-dialog vx-sheet vx-sizes";
      document.body.appendChild(sheet);
      sheet.addEventListener("click", (e) => {
        if (e.target === sheet || e.target.closest("[data-close]")) return sheet.close();
        const b = e.target.closest("[data-size]");
        if (!b) return;
        const now = products.find((x) => x.id === id);
        const o = now?.status === "available" && optionsOf(now).find((x) => x.size === b.dataset.size && x.left !== 0);
        sheet.close();
        if (!o) return render(); // it sold while the sheet was open
        pick = o.size; needPick = false;
        render();
        O.place({ ...now, price: o.price, sizes: o.size, chosenSize: o.size });
      });
    }
    const left = (o) => (o.left === 0 ? "Sold out" : o.left === 1 ? "Last one" : o.left <= 3 ? `${o.left} left` : multiPrice(p) ? "" : "In stock");
    const help = waLink(`Hi Vibe X, what are the chest and length measurements of ${p.name}? (${lot(p)})`);
    const pic = p.image ? `<img src="${esc(p.image)}" alt="">` : window.productArt(p, hash(p.id));
    sheet.innerHTML = `<div class="co">
      <button type="button" class="ask-x" data-close aria-label="Close">×</button>
      <div class="ask-item"><div class="ask-thumb ${p.image ? "" : "art-bg"}">${pic}</div>
        <div><span class="brand">${esc(p.brand || p.category)}</span><b>${esc(p.name)}</b><span class="mono">${multiPrice(p) ? "From " : ""}${rupees(p.price)}</span></div></div>
      <h2>Select size</h2>
      <div class="vx-size-grid" role="group" aria-label="Select size">${optionsOf(p).map((o) => `<button type="button" class="vx-size" data-size="${esc(o.size)}" ${o.left === 0 ? "disabled" : ""}><b>${esc(o.size)}</b>${multiPrice(p) && o.left !== 0 ? `<span>${rupees(o.price)}</span>` : ""}${left(o) ? `<span class="${o.left >= 1 && o.left <= 3 ? "low" : ""}">${left(o)}</span>` : ""}</button>`).join("")}</div>
      <p class="co-small">Tap your size and it goes in your bag.</p>
      ${help ? `<a class="pdp-size-help" href="${esc(help)}" target="_blank" rel="noopener" data-sizehelp="${esc(p.id)}">Not sure? Get measurements on WhatsApp</a>` : ""}
    </div>`;
    sheet.showModal();
    window.VXTrack?.("size_sheet", { pr: p.id });
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
          ${p.status === "available" ? O.quote(hash(p.id), "#pdp-reviews") : ""}
          ${sizePicker(p)}
          ${sizeGuide(p)}
          ${trust(p)}
          ${p.status === "available" ? O.whyCheap() : ""}
          <p class="pdp-desc">${esc(p.description)}</p>
          <dl class="pdp-facts">
            ${p.sizes && (optionsOf(p).length < 2 || p.status !== "available") ? `<div><dt>Size</dt><dd>${esc(p.sizes)}</dd></div>` : ""}
            <div><dt>Condition</dt><dd>Original</dd></div>
            <div><dt>In stock</dt><dd>${p.status === "sold" ? "Sold out" : p.status === "hold" ? "On hold for a buyer" : p.quantity > 1 ? `${p.quantity} pieces` : "Last one"}</dd></div>
            <div><dt>Get it</dt><dd>Pick up in Srinagar or ship anywhere in India${P.courier?.perKg ? `. Courier is ${P.courier.insideKashmirPerKg ? `${rupees(P.courier.insideKashmirPerKg)} per kg in Kashmir, ` : ""}${rupees(P.courier.perKg)} per kg outside` : ""}</dd></div>
          </dl>
          ${O.button(p, true)}
          ${promise(p)}
        </div>
      </div>
      ${starter(p, products)}
      ${O.reviews(8) ? `<section class="related rv" id="pdp-reviews"><h2>What customers say</h2>${O.reviews(8)}</section>` : ""}
      ${related.length ? `<section class="related"><h2>More ${esc(p.category.toLowerCase())}</h2><div class="related-row">${related.map(mini).join("")}</div></section>` : ""}`;
    if (p.status === "available") countPromise();
    // The full promise sits below the fold, so its first line goes where the thumb is.
    if (root.querySelector(".vx-promise")) root.querySelector(".pdp-info .actions")?.insertAdjacentHTML("afterbegin", `<button type="button" class="vx-sure" data-promise>Real, or your money back${P.changeOfMindDays ? ` · ${esc(P.changeOfMindDays)}-day returns` : ""}</button>`);
  }

  let lastJson = "";
  async function load() {
    if (drag) return; // mid-swipe: the next refresh redraws
    try {
      const res = await fetch("/api/products", { cache: "no-store" });
      const json = await res.text();
      if (json === lastJson) return; // redrawing would swallow a tap landing at that moment
      lastJson = json;
      products = JSON.parse(json);
      render();
    } catch { /* keep what's on screen */ }
  }

  // People kept tapping the photo. It opens over the page the way Myntra's does: the page dims behind a white
  // panel with the photo large, the small photos to pick from, and the name, price and Add to bag underneath.
  // With a mouse the photo is as wide as the panel and moving the mouse up and down travels along it. On a
  // phone the whole photo fits: a tap zooms into that spot, a drag looks around, a swipe changes the photo.
  function zoom(start) {
    const p = products.find((x) => x.id === id);
    const list = p ? photosOf(p) : [], n = list.length;
    if (!n) return;
    const Z = 2.5, mouse = matchMedia("(hover: hover) and (min-width: 821px)").matches;
    const buy = root.querySelector(".pdp-info [data-order]");
    let at = start, spot = [0.5, 0.5], pan = null, zx = null, lastY = null;
    const box = document.createElement("dialog");
    box.className = `pdp-zoom ${mouse ? "by-mouse" : "by-touch"}`;
    box.innerHTML = `<div class="pdp-zpanel">
      <div class="pdp-zstage"><img alt="" draggable="false"></div>
      ${n > 1 ? `<div class="pdp-zthumbs">${list.map((u, i) => `<button type="button" data-zshot="${i}" aria-label="Photo ${i + 1} of ${n}"><img src="${esc(u)}" alt="" loading="lazy" decoding="async"></button>`).join("")}</div>
      <button type="button" class="pdp-zbtn pdp-zstep prev" data-z="-1" aria-label="Previous photo">‹</button><button type="button" class="pdp-zbtn pdp-zstep next" data-z="1" aria-label="Next photo">›</button>` : ""}
      <button type="button" class="pdp-zbtn pdp-zclose" aria-label="Close photo">×</button>
      <div class="pdp-zfoot"><p class="pdp-zname"><b>${esc(p.name)}</b><span>${esc(root.querySelector(".pdp-price b")?.textContent || "")}</span></p>${buy ? `<button type="button" class="pdp-zadd">Let me have it</button>` : ""}</div>
    </div>`;
    const stage = box.querySelector(".pdp-zstage"), img = stage.querySelector("img");
    const clamp = (v) => Math.max(0, Math.min(1, v));
    // Mouse: where the pointer is, top to bottom, is how far down the photo you are (a little spare at each end).
    const travel = (y) => { lastY = y; const r = stage.getBoundingClientRect(); stage.scrollTop = clamp((y - r.top - r.height * 0.1) / (r.height * 0.8)) * (stage.scrollHeight - stage.clientHeight); };
    // Touch: the point of the photo held in place while it is 2.5 times bigger.
    const hold = (fx, fy) => { spot = [clamp(fx), clamp(fy)]; img.style.transformOrigin = `${spot[0] * 100}% ${spot[1] * 100}%`; };
    const zoomed = () => img.classList.contains("zoomed");
    const zoomTo = (on) => { img.classList.toggle("zoomed", on); stage.classList.toggle("zooming", on); pan = null; };
    const show = (i) => {
      at = ((i % n) + n) % n;
      zoomTo(false);
      img.src = list[at]; img.alt = `${p.name}, photo ${at + 1} of ${n}`;
      box.querySelectorAll("[data-zshot]").forEach((b, k) => { b.classList.toggle("on", k === at); b.setAttribute("aria-pressed", String(k === at)); if (k === at) b.scrollIntoView?.({ block: "nearest", inline: "nearest" }); });
    };
    show(at);
    img.addEventListener("load", () => { if (mouse) lastY == null ? (stage.scrollTop = 0) : travel(lastY); });
    box.addEventListener("click", (e) => { if (Date.now() - swiped < 400) e.stopImmediatePropagation(); }, { capture: true }); // the end of a swipe or drag isn't a tap
    box.addEventListener("click", (e) => {
      const t = e.target;
      if (t === box || t.closest(".pdp-zclose")) return box.close(); // the dark part around the panel closes it too
      const step = t.closest("[data-z]"), thumb = t.closest("[data-zshot]");
      if (step) return show(at + Number(step.dataset.z));
      if (thumb) return show(Number(thumb.dataset.zshot));
      if (t.closest(".pdp-zadd")) { box.close(); root.querySelector(".pdp-info [data-order]")?.click(); return; }
      if (!mouse && t === img) { if (zoomed()) return zoomTo(false); const r = stage.getBoundingClientRect(); hold((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); zoomTo(true); }
    });
    box.addEventListener("keydown", (e) => { if (n > 1 && (e.key === "ArrowLeft" || e.key === "ArrowRight")) { e.preventDefault(); show(at + (e.key === "ArrowRight" ? 1 : -1)); } });
    if (mouse) stage.addEventListener("mousemove", (e) => travel(e.clientY));
    stage.addEventListener("touchstart", (e) => {
      const one = e.touches.length === 1, t = e.touches[0];
      pan = one && zoomed() ? { x: t.clientX, y: t.clientY, from: spot, w: stage.clientWidth, h: stage.clientHeight, moved: false } : null;
      zx = one && !zoomed() && (window.visualViewport?.scale || 1) <= 1.01 ? [t.clientX, t.clientY] : null;
    }, { passive: true });
    stage.addEventListener("touchmove", (e) => {
      if (!pan) return;
      const dx = e.touches[0].clientX - pan.x, dy = e.touches[0].clientY - pan.y;
      if (!pan.moved && Math.hypot(dx, dy) > 8) pan.moved = true;
      if (pan.moved) hold(pan.from[0] - dx / (pan.w * (Z - 1)), pan.from[1] - dy / (pan.h * (Z - 1))); // the photo follows the finger
    }, { passive: true });
    stage.addEventListener("touchend", (e) => {
      if (pan) { if (pan.moved) swiped = Date.now(); pan = null; return; }
      if (!zx || n < 2) return;
      const dx = e.changedTouches[0].clientX - zx[0], dy = e.changedTouches[0].clientY - zx[1];
      zx = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { swiped = Date.now(); show(at + (dx < 0 ? 1 : -1)); }
    }, { passive: true });
    box.addEventListener("close", () => { box.remove(); if (n > 1) go(at, false); });
    document.body.append(box);
    box.showModal();
  }

  root.addEventListener("click", (e) => {
    if (Date.now() - swiped < 400 && e.target.closest(".pdp-gal")) return; // the end of a swipe isn't a tap
    const thumb = e.target.closest("[data-shot]");
    if (thumb) return go(Number(thumb.dataset.shot));
    const arrow = e.target.closest(".pdp-gal [data-step]");
    if (arrow) return go(shot + Number(arrow.dataset.step));
    const photo = e.target.closest(".pdp-media .media img");
    if (photo) return zoom(root.querySelector(".pdp-gal") ? shot : 0);
    if (e.target.closest(".vx-promise a")) window.VXTrack?.("nudge_tap", { x: "promise" });
    if (e.target.closest("[data-promise]")) { window.VXTrack?.("nudge_tap", { x: "promise" }); root.querySelector(".vx-promise")?.scrollIntoView({ block: "center", behavior: "smooth" }); return; }
    const b = e.target.closest("[data-pick]");
    if (!b) return;
    pick = b.dataset.pick;
    needPick = false;
    render();
  });

  // Swiping the big photo drags the strip with the finger. Up and down still scrolls the page, and
  // two fingers are a pinch, never a swipe (the strip lets the browser handle both: see shop.css).
  root.addEventListener("touchstart", (e) => {
    const gal = e.target.closest(".pdp-gal");
    drag = gal && e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, axis: null, w: gal.clientWidth, n: gal.querySelectorAll(".pdp-track img").length, track: gal.querySelector(".pdp-track") } : null;
  }, { passive: true });
  root.addEventListener("touchmove", (e) => {
    if (!drag) return;
    if (e.touches.length !== 1) { const d = drag; drag = null; if (d.axis === "x") go(shot); return; }
    const dx = e.touches[0].clientX - drag.x, dy = e.touches[0].clientY - drag.y;
    if (!drag.axis && Math.hypot(dx, dy) > 8) drag.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    if (drag.axis !== "x") return;
    const edge = (shot === 0 && dx > 0) || (shot === drag.n - 1 && dx < 0);
    drag.dx = edge ? dx / 3 : dx; // past the first or last photo it only gives a little
    drag.track.classList.remove("glide");
    drag.track.style.transform = `translateX(calc(${-shot * 100}% + ${drag.dx}px))`;
  }, { passive: true });
  const endDrag = () => {
    const d = drag;
    drag = null;
    if (!d || d.axis !== "x") return;
    swiped = Date.now();
    const far = Math.abs(d.dx) > Math.min(60, d.w * 0.18);
    go(far ? Math.max(0, Math.min(d.n - 1, shot + (d.dx < 0 ? 1 : -1))) : shot);
  };
  root.addEventListener("touchend", endDrag, { passive: true });
  root.addEventListener("touchcancel", endDrag, { passive: true });
  // Left and right arrow keys move through the photos (not while typing, or with the bag open).
  document.addEventListener("keydown", (e) => {
    if ((e.key !== "ArrowLeft" && e.key !== "ArrowRight") || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (!root.querySelector(".pdp-gal") || document.querySelector("dialog[open]") || e.target.closest?.("input, textarea, select, [contenteditable]")) return;
    e.preventDefault();
    go(shot + (e.key === "ArrowRight" ? 1 : -1));
  });
  // A photo whose file is missing drops out of the gallery (or the page shows the drawing instead).
  root.addEventListener("error", (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.closest(".pdp-media")) return;
    const u = img.getAttribute("src");
    const p = products.find((x) => x.id === id);
    if (!u || broken.has(u) || !p || !photosOf(p).includes(u)) return;
    broken.add(u);
    render();
  }, true);

  O.install((pid) => products.find((p) => p.id === pid), (pid) => {
    const p = products.find((x) => x.id === pid);
    if (!p) return null;
    const chosen = chosenOf(p);
    if (optionsOf(p).length > 1 && !chosen) {
      if (optionsOf(p).some((o) => o.left !== 0)) { openSizes(p); return null; }
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
