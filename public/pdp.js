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

  const offPct = (p) => (p.mrp && p.price && p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0);

  function media(p) {
    const pic = p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}">` : window.productArt(p, hash(p.id));
    return `<div class="media ${p.image ? "" : "art-bg"}">${pic}<span class="lot">${lot(p)}</span>
      ${p.status === "sold" ? `<div class="sold-stamp"><span>SOLD</span></div>` : ""}
      ${p.status === "hold" ? `<div class="sold-stamp hold-stamp"><span>ON HOLD</span></div>` : ""}</div>`;
  }

  function mini(p) {
    return `<a class="mini" href="${BASE}/p/${encodeURIComponent(p.id)}">${media(p)}
      <span class="brand">${esc(p.brand || p.category)}</span><b>${esc(p.name)}</b><span class="mono">${p.price ? rupees(p.price) : "Ask"}</span></a>`;
  }

  const optionsOf = (p) => p.options || [];
  // Only one size can be bought: that's chosen for them. Otherwise never guess, a wrong size means a return.
  const chosenOf = (p) => { const o = optionsOf(p).filter((x) => x.left !== 0); return o.length === 1 ? o[0] : o.find((x) => x.size === pick) || null; };
  const multiPrice = (p) => new Set(optionsOf(p).map((o) => o.price)).size > 1;

  function sizePicker(p) {
    const opts = optionsOf(p);
    if (opts.length < 2 || p.status !== "available") return "";
    const on = chosenOf(p)?.size;
    const label = (o) => esc(o.size) + (o.left === 0 ? " · sold out" : multiPrice(p) ? ` · ${rupees(o.price)}` : "");
    return `<div class="pdp-sizes" role="group" aria-label="Choose size">
        <p class="label">Choose size</p>
        <div class="pills">${opts.map((o) => `<button type="button" class="pill${o.size === on ? " on" : ""}" data-pick="${esc(o.size)}" aria-pressed="${o.size === on}" ${o.left === 0 ? "disabled" : ""}>${label(o)}</button>`).join("")}</div>
        ${needPick ? `<p class="ask-err" role="alert">Choose your size to order</p>` : ""}
      </div>`;
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
        <div class="pdp-media">${media(p)}</div>
        <div class="pdp-info">
          <p class="label">${esc([p.category, p.subcategory].filter(Boolean).join(" › "))}</p>
          ${p.brand ? `<span class="brand">${esc(p.brand)}</span>` : ""}
          <h1>${esc(p.name)}</h1>
          <div class="pdp-price">
            <b>${price ? `${from ? "From " : ""}${rupees(price)}` : "Ask for price"}</b>
            ${off ? `<s>${rupees(p.mrp)}</s><span class="off">${off}% OFF</span>` : ""}
          </div>
          <p class="pdp-desc">${esc(p.description)}</p>
          ${sizePicker(p)}
          <dl class="pdp-facts">
            ${p.sizes && (optionsOf(p).length < 2 || p.status !== "available") ? `<div><dt>Size</dt><dd>${esc(p.sizes)}</dd></div>` : ""}
            <div><dt>Condition</dt><dd>Original</dd></div>
            <div><dt>In stock</dt><dd>${p.status === "sold" ? "Sold out" : p.status === "hold" ? "On hold for a buyer" : p.quantity > 1 ? `${p.quantity} pieces` : "Last one"}</dd></div>
            <div><dt>Get it</dt><dd>Pick up in Srinagar or ship anywhere in India</dd></div>
          </dl>
          ${O.button(p, true)}
        </div>
      </div>
      ${related.length ? `<section class="related"><h2>More ${esc(p.category.toLowerCase())}</h2><div class="related-row">${related.map(mini).join("")}</div></section>` : ""}`;
  }

  async function load() {
    try {
      const res = await fetch("/api/products", { cache: "no-store" });
      products = await res.json();
      render();
    } catch { /* keep what's on screen */ }
  }

  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pick]");
    if (!b) return;
    pick = b.dataset.pick;
    needPick = false;
    render();
  });

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
  setInterval(load, 5000);
})();
