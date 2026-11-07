// Search: the magnifier in the header opens a box under it. Results appear as the customer types
// (photo, name, price); Enter or "See all" filters the rack below to every match.
// The matching lives here so the rack (shop.js) and the box agree on what a match is.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rupees = (n) => "₹" + Number(n).toLocaleString("en-IN");
  const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9₹]+/g, " ").trim();
  // A few words people use that the listings don't: "perfume" finds fragrances, "shoes" footwear.
  const ALSO = { perfume: "fragrance", perfumes: "fragrance", scent: "fragrance", attar: "fragrance", shoes: "footwear", shoe: "footwear", sneakers: "footwear", boots: "footwear", jacket: "clothing jacket", coat: "jacket", hoodie: "hoodie sweatshirt", tshirt: "t shirt tee", tee: "t shirt tee" };

  // What a product can be found by. Not the description: most say "from the Vibe X store in
  // Srinagar", which would make "srinagar" match everything.
  const hay = (p) => " " + norm([p.name, p.brand, p.category, p.subcategory, p.sizes, p.code, ...(p.options || []).map((o) => o.size)].join(" ")) + " ";
  const words = (q) => norm(q).split(" ").filter(Boolean);
  // Every word must be found, at the start of a word in the listing ("puff" finds puffer,
  // "jackets" finds jacket). Returns a score, 0 = no match.
  function score(p, q) {
    const ws = words(q);
    if (!ws.length) return 0;
    const h = hay(p), name = " " + norm(p.name) + " ";
    let s = 0;
    for (const w of ws) {
      const forms = [w, w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : null, ...(ALSO[w] ? ALSO[w].split(" ") : [])].filter(Boolean);
      const hit = forms.find((f) => h.includes(" " + f));
      if (!hit) return 0;
      s += name.includes(" " + hit) ? 3 : 1;
      if (p.code && norm(p.code) === w) s += 10;
    }
    if (p.status === "available") s += 2;
    return s;
  }
  const find = (list, q) => list.map((p) => [p, score(p, q)]).filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1] || new Date(b[0].createdAt) - new Date(a[0].createdAt)).map(([p]) => p);
  window.VXSearch = { score, find };

  // ---- the box ----
  const btn = $("search-btn"), box = $("search"), input = $("search-q"), out = $("search-out");
  if (!btn || !box) return;
  const S = window.SHOP || {};
  const BASE = window.VX_BASE || "";
  const MAX = 6;
  let list = () => [];
  let onAll = () => {};
  // shop.js hands over the live stock and how to filter the rack
  window.VXSearch.connect = (getProducts, showAll) => { list = getProducts; onAll = showAll; if (!box.hidden) draw(); };

  function draw() {
    const q = input.value.trim();
    if (!q) { out.innerHTML = ""; return; }
    const hits = find(list(), q);
    if (!hits.length) {
      const ask = S.whatsapp ? `https://wa.me/${S.whatsapp}?text=${encodeURIComponent(`Hi Vibe X! Do you have ${q}?`)}` : "";
      out.innerHTML = `<p class="sr-none">Nothing matches “${esc(q)}” right now.${ask ? ` <a href="${ask}" target="_blank" rel="noopener">Ask us on WhatsApp</a>, new stock lands most days.` : ""}</p>`;
      return;
    }
    out.innerHTML = `<ul class="sr-list">${hits.slice(0, MAX).map((p) => `
      <li><a class="sr-item" href="${BASE}/p/${encodeURIComponent(p.id)}">
        <span class="sr-pic">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" decoding="async">` : ""}</span>
        <span class="sr-text"><b>${esc(p.name)}</b><em>${esc([p.brand && p.brand !== p.name ? p.brand : p.category, p.sizes].filter(Boolean).join(" · "))}</em></span>
        <span class="sr-price">${p.status === "sold" ? "Sold" : p.status === "hold" ? "On hold" : p.price ? rupees(p.price) : ""}</span>
      </a></li>`).join("")}</ul>
      <button type="button" class="sr-all" data-sr-all>See ${hits.length === 1 ? "it" : `all ${hits.length}`} in the shop <span aria-hidden="true">→</span></button>`;
  }

  function open() {
    box.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => box.classList.add("on"));
    input.focus();
    input.select(); // last search stays, and typing replaces it
    draw();
  }
  function close(keepFocus) {
    box.classList.remove("on");
    box.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    if (keepFocus) btn.focus();
  }
  function showAll() {
    const q = input.value.trim();
    if (!q) return;
    close();
    input.blur();
    onAll(q);
  }

  btn.addEventListener("click", () => (box.hidden ? open() : close(true)));
  // The VIBEX logo opens search too (logo.js calls this; it doesn't run for reduced motion, so here).
  const logo = document.querySelector(".top .logo");
  window.VXSearch.open = open;
  if (logo) {
    logo.setAttribute("aria-label", "Vibe X, search the shop");
    logo.setAttribute("aria-controls", "search");
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) logo.addEventListener("click", (e) => { e.preventDefault(); open(); });
  }
  input.addEventListener("input", draw);
  $("search-form").addEventListener("submit", (e) => { e.preventDefault(); showAll(); });
  $("search-x").addEventListener("click", () => close(true));
  out.addEventListener("click", (e) => { if (e.target.closest("[data-sr-all]")) showAll(); });
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !box.hidden) { close(true); return; }
    // "/" opens search on a computer, unless the customer is typing somewhere
    if (e.key === "/" && box.hidden && !e.target.closest("input, textarea, select, [contenteditable]") && !e.metaKey && !e.ctrlKey) { e.preventDefault(); open(); }
  });
  // a tap anywhere else closes it
  document.addEventListener("pointerdown", (e) => { if (!box.hidden && !box.contains(e.target) && !btn.contains(e.target) && !logo?.contains(e.target)) close(); });
})();
