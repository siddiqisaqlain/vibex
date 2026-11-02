// Product page: /p/<id>. The server already put the share-preview tags in <head>;
// this draws the page itself and keeps it current if the item sells.
(() => {
  const O = window.VXOrder;
  const { esc, rupees, lot, hash } = O;
  const root = document.getElementById("pdp");
  const id = root.dataset.id;
  let products = [];

  const offPct = (p) => (p.mrp && p.price && p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0);

  function media(p) {
    const pic = p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}">` : window.productArt(p, hash(p.id));
    const left = p.status === "sold" ? `<span class="badge badge-sold">Sold</span>`
      : p.status === "hold" ? `<span class="badge badge-hold">On hold</span>` : "<span></span>";
    return `<div class="media ${p.image ? "" : "art-bg"}">${pic}<div class="badges">${left}<span class="badge">${lot(p)}</span></div></div>`;
  }

  function mini(p) {
    return `<a class="mini" href="/p/${encodeURIComponent(p.id)}" data-cat="${esc(p.category)}">${media(p)}
      <span class="brand">${esc(p.brand || p.category)}</span><b>${esc(p.name)}</b><span class="mono">${p.price ? rupees(p.price) : "Ask"}</span></a>`;
  }

  function render() {
    const p = products.find((x) => x.id === id);
    if (!p) {
      root.innerHTML = `<div class="pdp-gone"><i class="ph ph-package" aria-hidden="true"></i><h1>This piece has left the rack</h1><p>It was sold or taken down. New stock is unpacked most days.</p><a class="btn btn-primary" href="/#rack">See today's drops <i class="ph ph-arrow-right" aria-hidden="true"></i></a></div>`;
      return;
    }
    const off = offPct(p);
    const related = products.filter((x) => x.id !== p.id && x.category === p.category && x.status === "available").slice(0, 4);
    root.innerHTML = `
      <a class="back" href="/#rack"><i class="ph ph-arrow-left" aria-hidden="true"></i>Back to the rack</a>
      <div class="pdp-grid" data-cat="${esc(p.category)}">
        <div class="pdp-media">${media(p)}</div>
        <div class="pdp-info">
          <p class="eyebrow">${esc([p.category, p.subcategory].filter(Boolean).join(" · "))}</p>
          ${p.brand ? `<span class="brand">${esc(p.brand)}</span>` : ""}
          <h1>${esc(p.name)}</h1>
          <div class="pdp-price">
            <b>${p.price ? rupees(p.price) : "Ask for price"}</b>
            ${off ? `<s>${rupees(p.mrp)}</s><span class="off">${off}% below retail</span>` : ""}
          </div>
          <dl class="pdp-facts">
            ${p.sizes ? `<div><dt>Size</dt><dd>${esc(p.sizes)}</dd></div>` : ""}
            <div><dt>Condition</dt><dd>Original</dd></div>
            <div><dt>In stock</dt><dd>${p.status === "sold" ? "Sold out" : p.status === "hold" ? "On hold for a buyer" : p.quantity > 1 ? `${p.quantity} pieces` : "Last one"}</dd></div>
            <div><dt>Get it</dt><dd>Pick up in Srinagar, or delivered anywhere in India</dd></div>
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

  O.install((pid) => products.find((p) => p.id === pid));
  load();
  setInterval(load, 5000);
})();
