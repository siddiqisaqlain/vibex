(() => {
  const S = window.SHOP;
  const $ = (id) => document.getElementById(id);
  const CATS = ["All", "Clothing", "Fragrances", "Footwear", "Accessories"];
  const SHELF = {
    Clothing: ["Clothing", "Jackets, fleece and denim from the world's outdoor and street labels."],
    Fragrances: ["Fragrances", "Designer and niche scents, original bottles."],
    Footwear: ["Footwear", "Boots, sneakers and leather shoes."],
    Accessories: ["Accessories", "Caps, bags and the small things."],
  };
  const NEW_HOURS = 48;
  const BASE_BRANDS = ["The North Face", "Patagonia", "Carhartt", "Columbia", "Levi's", "Ralph Lauren", "Lattafa", "Tommy Hilfiger"];

  let products = [];
  let filter = "All";
  let sub = null; // subcategory inside a category, e.g. "Jacket"
  let known = null;
  let featuredId = null;


  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rupees = (n) => "₹" + Number(n).toLocaleString("en-IN");
  const hash = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const lot = (p) => "Lot " + (p.code || String(hash(p.id) % 9000 + 1000));
  const hoursOld = (p) => (Date.now() - new Date(p.createdAt)) / 3600e3;
  const isNew = (p) => p.status === "available" && hoursOld(p) < NEW_HOURS;
  const offPct = (p) => (p.mrp && p.price && p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0);

  function ago(p) {
    const h = hoursOld(p);
    if (h < 1) return "just now";
    if (h < 24) return `${Math.floor(h)}h ago`;
    const d = Math.floor(h / 24);
    return d === 1 ? "yesterday" : `${d}d ago`;
  }

  function media(p, extraClass = "", eager = false) {
    const pic = p.image
      ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="${eager ? "eager" : "lazy"}" decoding="async">`
      : window.productArt(p, hash(p.id));
    return `<div class="media ${p.image ? "" : "art-bg"} ${extraClass}">${pic}<a class="cover" href="/p/${encodeURIComponent(p.id)}" aria-label="${esc(p.name)}"></a>`;
  }

  function badges(p) {
    const left = p.status === "sold" ? `<span class="badge badge-sold">Sold</span>`
      : p.status === "hold" ? `<span class="badge badge-hold">On hold</span>`
      : isNew(p) ? `<span class="badge badge-new">Just in</span>` : "<span></span>";
    return `<div class="badges">${left}<span class="badge">${lot(p)}</span></div>`;
  }

  function priceRow(p) {
    const off = offPct(p);
    return `<div class="price-row"><span class="price">${p.price ? rupees(p.price) : "Price on request"}</span>
      ${off ? `<s class="mrp">${rupees(p.mrp)}</s><span class="off">${off}% off</span>` : ""}</div>`;
  }

  function card(p, eager) {
    return `
      <article class="card${p.status === "sold" ? " sold" : ""}${p.status === "hold" ? " hold" : ""}" data-id="${esc(p.id)}">
        ${media(p, "", eager)}${badges(p)}</div>
        <div class="info">
          ${p.brand ? `<span class="brand">${esc(p.brand)}</span>` : ""}
          <h3 class="name"><a href="/p/${encodeURIComponent(p.id)}">${esc(p.name)}</a></h3>
          <span class="meta">${[p.subcategory, p.sizes, p.quantity > 1 && p.status !== "sold" ? `${p.quantity} left` : null, ago(p)].filter(Boolean).map(esc).join(" · ")}</span>
          ${priceRow(p)}
          ${window.VXOrder.button(p)}
        </div>
      </article>`;
  }

  // Hero card: the newest piece. One primary action per page lives in the hero copy,
  // so this card is a link to the piece rather than another set of buttons.
  function renderFeature(animate) {
    const p = products.filter((x) => x.status === "available").sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    if (!p) { $("feature").innerHTML = ""; return; }
    const changed = p.id !== featuredId;
    featuredId = p.id;
    const off = offPct(p);
    const pic = p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}">` : window.productArt(p, hash(p.id));
    $("feature").innerHTML = `
      <a class="feature-card${animate && changed ? " swap" : ""}" href="/p/${encodeURIComponent(p.id)}">
        <span class="feature-label"><span class="dot" aria-hidden="true"></span>Latest drop · ${esc(ago(p))}</span>
        <div class="media ${p.image ? "" : "art-bg"}">${pic}</div>
        <div class="feature-body">
          ${p.brand ? `<span class="brand">${esc(p.brand)}</span>` : ""}
          <div><h3>${esc(p.name)}</h3><span class="meta">${[p.sizes, p.category].filter(Boolean).map(esc).join(" · ")}</span></div>
          <div class="feature-price"><b>${p.price ? rupees(p.price) : "Ask"}</b>${off ? `<s>${rupees(p.mrp)}</s>` : ""}</div>
          <span class="feature-go">View this piece <i class="ph ph-arrow-right" aria-hidden="true"></i></span>
        </div>
      </a>`;
  }

  function renderMarquees() {
    const live = [...new Set(products.map((p) => p.brand).filter(Boolean))];
    const brands = [...new Set([...live, ...BASE_BRANDS])];
    const row = brands.map((b) => `<span>${esc(b)}</span>`).join("");
    $("brands").innerHTML = row + row;
  }

  function renderFilters() {
    $("filters").innerHTML = CATS.map((c) => {
      const n = c === "All" ? products.length : products.filter((p) => p.category === c).length;
      if (c !== "All" && !n) return "";
      return `<button role="tab" aria-selected="${c === filter}" data-cat="${c}">${c}<sup>${n}</sup></button>`;
    }).join("");
  }

  const sortRack = (a, b) => (a.status === "sold") - (b.status === "sold") || (a.status === "hold") - (b.status === "hold") || new Date(b.createdAt) - new Date(a.createdAt);

  function renderSubs() {
    const el = $("subs");
    if (filter === "All") { el.hidden = true; el.innerHTML = ""; return; }
    const counts = {};
    for (const p of products) if (p.category === filter && p.subcategory) counts[p.subcategory] = (counts[p.subcategory] || 0) + 1;
    const names = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    if (names.length < 2) { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;
    el.innerHTML = [`<button data-sub="" aria-pressed="${!sub}">All ${esc(filter.toLowerCase())}</button>`]
      .concat(names.map((n) => `<button data-sub="${esc(n)}" aria-pressed="${sub === n}">${esc(n)}<sup>${counts[n]}</sup></button>`))
      .join("");
  }

  // Cards are kept between updates and only rebuilt when that product changed, so photos
  // already on screen never reload or go blank (phone browsers can skip lazy photos in
  // content that is swapped in live). The first rows and new pieces load photos at once.
  const cardCache = new Map(); // id -> { sig, el }
  const slot = (p, i) => `<div class="slot" data-id="${esc(p.id)}" data-i="${i}"></div>`;
  function fillSlots(fresh) {
    const byId = new Map(products.map((p) => [p.id, p]));
    for (const el of $("grid").querySelectorAll(".slot")) {
      const p = byId.get(el.dataset.id);
      if (!p) { el.remove(); continue; }
      const sig = card(p, Number(el.dataset.i) < 8 || fresh.has(p.id));
      let hit = cardCache.get(p.id);
      if (!hit || hit.sig !== sig) {
        const t = document.createElement("template");
        t.innerHTML = sig.trim();
        hit = { sig, el: t.content.firstElementChild };
        cardCache.set(p.id, hit);
      }
      hit.el.classList.toggle("fresh", fresh.has(p.id));
      el.replaceWith(hit.el);
    }
    for (const id of cardCache.keys()) if (!byId.has(id)) cardCache.delete(id);
  }

  function renderGrid(fresh = new Set()) {
    let html = "";
    if (filter === "All") {
      // Curated shelves: one section per category, in shop order.
      for (const cat of CATS.slice(1)) {
        const list = products.filter((p) => p.category === cat).sort(sortRack);
        if (!list.length) continue;
        const [title, blurb] = SHELF[cat];
        html += `<section class="shelf"><header class="shelf-head"><div><h3>${title}<sup>${list.length}</sup></h3><p>${blurb}</p></div>
          <button class="shelf-all" data-cat="${cat}">See all ${title.toLowerCase()} <i class="ph ph-arrow-right" aria-hidden="true"></i></button></header>
          <div class="grid">${list.map(slot).join("")}</div></section>`;
      }
    } else {
      const list = products.filter((p) => p.category === filter && (!sub || p.subcategory === sub)).sort(sortRack);
      if (list.length) html = `<div class="grid">${list.map(slot).join("")}</div>`;
    }
    $("grid").innerHTML = html;
    fillSlots(fresh);
    $("empty").hidden = html !== "";
    const avail = products.filter((p) => p.status === "available").length;
    const fresh48 = products.filter(isNew).length;
    $("count").textContent = `${avail} pieces in stock · ${fresh48} new in the last 2 days`;
    renderFilters();
    renderSubs();
  }

  function setFilter(cat) {
    filter = CATS.includes(cat) ? cat : "All";
    sub = null;
    renderGrid();
  }

  const toast = (html) => window.VXOrder.toast(html, 6000);

  let lastJson = "";
  async function refresh() {
    try {
      const res = await fetch("/api/products", { cache: "no-store" });
      const json = await res.text();
      if (json === lastJson) return;
      lastJson = json;
      const next = JSON.parse(json);
      const fresh = new Set(known ? next.filter((p) => !known.has(p.id)).map((p) => p.id) : []);
      const first = known === null;
      known = new Set(next.map((p) => p.id));
      products = next;
      renderGrid(fresh);
      renderFeature(!first);
      if (first) renderMarquees();
      if (fresh.size) {
        const p = next.find((x) => fresh.has(x.id));
        toast(`<b>New drop</b><span>${esc(p.name)}${p.price ? ` · ${rupees(p.price)}` : ""}</span><button type="button" class="toast-go" data-goto="${esc(p.id)}">See it</button>`);
      }
    } catch { /* server restarting; next tick retries */ }
  }

  $("filters").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-cat]");
    if (b) setFilter(b.dataset.cat);
  });
  $("grid").addEventListener("click", (e) => {
    const b = e.target.closest("button.shelf-all");
    if (!b) return;
    setFilter(b.dataset.cat);
    document.getElementById("rack").scrollIntoView({ behavior: "smooth" });
  });
  $("subs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-sub]");
    if (!b) return;
    sub = b.dataset.sub || null;
    renderGrid();
  });
  document.querySelectorAll("[data-jump]").forEach((a) => a.addEventListener("click", () => setFilter(a.dataset.jump)));

  window.VXOrder.install((id) => products.find((p) => p.id === id));

  // Jump to a new piece from the "New drop" toast.
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-goto]");
    if (!b) return;
    const p = products.find((x) => x.id === b.dataset.goto);
    if (p && filter !== "All" && p.category !== filter) setFilter("All");
    const el = document.querySelector(`.card[data-id="${CSS.escape(b.dataset.goto)}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    $("toast").hidden = true;
  });

  // Phones pause background tabs; catch up the moment the page is shown again.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  window.addEventListener("pageshow", (e) => { if (e.persisted) refresh(); });
  window.addEventListener("focus", refresh);

  refresh();
  setInterval(refresh, 2000);
})();
