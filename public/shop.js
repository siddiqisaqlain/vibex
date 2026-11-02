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

  for (const [id, url] of [["ig-top", S.instagram], ["ig-visit", S.instagram], ["map-hero", S.maps], ["map-visit", S.maps]]) $(id).href = url;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rupees = (n) => "₹" + Number(n).toLocaleString("en-IN");
  const hash = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const lot = (p) => "LOT " + (p.code || String(hash(p.id) % 9000 + 1000));
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

  function card(p, eager) {
    const off = offPct(p);
    return `
      <article class="card${p.status === "sold" ? " sold" : ""}" data-id="${esc(p.id)}" data-cat="${esc(p.category)}">
        ${media(p, "", eager)}
          <span class="lot">${lot(p)}</span>
          ${isNew(p) ? `<span class="badge">Just in</span>` : ""}
          <div class="tag">
            <b>${p.price ? rupees(p.price) : "Ask"}</b>
            ${off ? `<s>${rupees(p.mrp)}</s><span class="off">−${off}%</span>` : ""}
          </div>
          ${p.status === "sold" ? `<div class="sold-stamp"><span>SOLD</span></div>` : ""}
          ${p.status === "hold" ? `<div class="sold-stamp hold-stamp"><span>ON HOLD</span></div>` : ""}
        </div>
        <div class="info">
          ${p.brand ? `<span class="brand">${esc(p.brand)}</span>` : ""}
          <h3 class="name"><a href="/p/${encodeURIComponent(p.id)}">${esc(p.name)}</a></h3>
          <span class="meta">${[p.subcategory, p.sizes, p.quantity > 1 && p.status !== "sold" ? `${p.quantity} left` : null, ago(p)].filter(Boolean).map(esc).join(" · ")}</span>
          ${window.VXOrder.button(p)}
        </div>
      </article>`;
  }

  function renderFeature(animate) {
    const p = products.filter((x) => x.status === "available").sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    if (!p) { $("feature").innerHTML = ""; return; }
    const changed = p.id !== featuredId;
    featuredId = p.id;
    const off = offPct(p);
    $("feature").innerHTML = `
      <div class="feature-sticker">${off ? `${off}%<br>off` : "Just<br>in"}</div>
      <div class="feature-card${animate && changed ? " swap" : ""}">
        <div class="feature-head"><span>Latest drop</span><span class="live"><span class="dot"></span>${ago(p)}</span></div>
        ${media(p)}<span class="lot">${lot(p)}</span></div>
        <div class="feature-body">
          ${p.brand ? `<span class="brand">${esc(p.brand)}</span>` : ""}
          <div class="feature-row">
            <div><h3>${esc(p.name)}</h3><span class="meta">${[p.sizes, p.category].filter(Boolean).map(esc).join(" · ")}</span></div>
            <div class="feature-price"><b>${p.price ? rupees(p.price) : "Ask"}</b>${off ? `<s>${rupees(p.mrp)}</s>` : ""}</div>
          </div>
          ${window.VXOrder.button(p)}
        </div>
      </div>`;
  }

  function renderMarquees() {
    const live = [...new Set(products.map((p) => p.brand).filter(Boolean))];
    const brands = [...new Set([...live, ...BASE_BRANDS])];
    const row = brands.map((b) => `<span>${esc(b)}</span>`).join("");
    $("brands").innerHTML = row + row;
    const t = ["New drops posted daily", "100% original", "Pan-India shipping", "100,000+ orders delivered", "Srinagar, Kashmir"]
      .map((x) => `<span>${x}</span>`).join("");
    $("ticker").innerHTML = t + t + t + t;
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

  // Cards are kept between live updates and only rebuilt when that product changed, so
  // photos never reload or go blank on phones. First rows and new pieces load photos at once.
  const cardCache = new Map();
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
        html += `<section class="shelf"><header class="shelf-head"><h3>${title}<sup>${list.length}</sup></h3><p>${blurb}</p>
          <button class="shelf-all" data-cat="${cat}">See all ${title.toLowerCase()} →</button></header>
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
    $("count").textContent = `${avail} pieces in · ${fresh48} new in 48h`;
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
