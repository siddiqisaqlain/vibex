// Vibe X homepage, v5 (department-store layout: category pills, banner slider, dense grid,
// shop by size / price / brand). Everything is drawn from /api/products and stays live.
(() => {
  const S = window.SHOP;
  const $ = (id) => document.getElementById(id);
  const CATS = ["Clothing", "Fragrances", "Footwear", "Accessories"];
  const BLURB = {
    Clothing: "Jackets, fleece and denim from the world's outdoor and street labels.",
    Fragrances: "Designer and niche scents. Original bottles.",
    Footwear: "Boots, sneakers and leather shoes.",
    Accessories: "Caps, bags and the small things.",
  };
  const NEW_HOURS = 48;
  const PAGE = 10;
  const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "XXXL", "3XL"];
  const BANDS = [
    { id: "u1000", label: "Under ₹1,000", test: (n) => n < 1000 },
    { id: "1000", label: "₹1,000 – ₹1,999", test: (n) => n >= 1000 && n < 2000 },
    { id: "2000", label: "₹2,000 – ₹2,999", test: (n) => n >= 2000 && n < 3000 },
    { id: "3000", label: "₹3,000 and up", test: (n) => n >= 3000 },
  ];

  let products = [];
  // What the rack shows: a tab (All / New / a category) plus optional narrowing.
  const view = { tab: "All", sub: null, size: null, band: null, brand: null, shown: PAGE };
  let known = null;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rupees = (n) => "₹" + Number(n).toLocaleString("en-IN");
  const hash = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const hoursOld = (p) => (Date.now() - new Date(p.createdAt)) / 3600e3;
  const isNew = (p) => p.status === "available" && hoursOld(p) < NEW_HOURS;
  const offPct = (p) => (p.mrp && p.price && p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0);
  const BASE = window.VX_BASE || ""; // "/preview/<name>" when shown as a hidden preview
  const pdp = (p) => `${BASE}/p/${encodeURIComponent(p.id)}`;
  const wa = S.whatsapp ? `https://wa.me/${S.whatsapp}?text=${encodeURIComponent("Hi Vibe X! I saw your website.")}` : S.instagram;

  // ---- static bits from shop.json ----
  for (const [id, url] of [["ig-top", S.instagram], ["ig-visit", S.instagram], ["ig-foot", S.instagram], ["map-visit", S.maps], ["map-foot", S.maps], ["wa-top", wa], ["wa-foot", wa], ["wa-dock", wa]]) {
    const el = $(id); if (el) el.href = url;
  }
  const B = S.business || {};
  $("foot-biz").innerHTML = [B.legalName, B.address, B.phone, B.email, B.gstin && `GSTIN ${B.gstin}`].filter(Boolean).map(esc).join(" · ");
  $("store-addr").textContent = B.address || S.city || "Srinagar, Kashmir";
  if (B.phone) { $("store-phone").textContent = B.phone; $("store-phone").href = `tel:${B.phone.replace(/\s/g, "")}`; }
  else $("store-phone").parentElement.hidden = true;

  // Trust strip: only the numbers the owner confirmed (shop.json → claims.stats).
  const ICONS = [
    '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/>',
    '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
    '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    '<path d="M5 12l4 4L19 6"/>',
  ];
  const stats = (S.claims && S.claims.stats) || [];
  $("stats").innerHTML = stats.map((x, i) => `<div><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[i] || ICONS[3]}</svg><p><b>${esc(x.big)}</b><span>${esc(x.small)}</span></p></div>`).join("");
  $("stats").hidden = !stats.length;
  $("stats").style.setProperty("--n", Math.max(1, stats.length));

  // ---- red announcement bar: one message at a time ----
  function renderTicker() {
    const msgs = (S.claims && S.claims.ticker) || [];
    const bar = $("ticker");
    bar.parentElement.hidden = !msgs.length;
    bar.innerHTML = msgs.map((x, i) => `<span class="${i ? "" : "on"}">${esc(x)}</span>`).join("");
    if (msgs.length < 2) return;
    let i = 0;
    setInterval(() => {
      const all = bar.children;
      all[i].classList.replace("on", "out");
      i = (i + 1) % all.length;
      const next = all[i];
      next.classList.add("prep"); next.classList.remove("out");
      void next.offsetWidth;
      next.classList.remove("prep"); next.classList.add("on");
    }, 3500);
  }

  // ---- product card ----
  let sales = [];
  const soldAt = (p) => sales.find((s) => s.id === p.id)?.at;
  const agoAt = (at) => {
    const m = Math.floor((Date.now() - new Date(at)) / 60e3);
    if (m < 2) return "just now";
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h}h ago` : h < 48 ? "yesterday" : `${Math.floor(h / 24)}d ago`;
  };
  // Badges only say what is true right now: fresh posts and real stock counts.
  function badges(p) {
    const out = [];
    if (isNew(p)) out.push(`<span class="badge">${hoursOld(p) < 24 ? "New today" : "Just in"}</span>`);
    if (p.status === "available") {
      if (p.quantity >= 2 && p.quantity <= 3) out.push(`<span class="badge badge-low">Only ${p.quantity} left</span>`);
      else if (p.quantity === 1 && soldAt(p)) out.push(`<span class="badge badge-low">Last one</span>`);
    }
    return out.length ? `<div class="badges">${out.join("")}</div>` : "";
  }
  function pic(p, eager) {
    return p.image
      ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="${eager ? "eager" : "lazy"}" decoding="async">`
      : window.productArt(p, hash(p.id));
  }
  function card(p, eager) {
    const off = offPct(p);
    const meta = [p.sizes, p.status === "sold" && soldAt(p) ? `Sold ${agoAt(soldAt(p))}` : null].filter(Boolean).map(esc).join(" · ");
    return `
      <article class="card${p.status === "sold" ? " sold" : ""}" data-id="${esc(p.id)}">
        <div class="media ${p.image ? "" : "art-bg"}">${pic(p, eager)}<a class="cover" href="${pdp(p)}" aria-label="${esc(p.name)}"></a>
          ${badges(p)}
          ${p.status === "sold" ? `<div class="sold-stamp"><span>Sold out</span></div>` : ""}
          ${p.status === "hold" ? `<div class="sold-stamp hold-stamp"><span>On hold</span></div>` : ""}
        </div>
        <div class="info">
          <span class="brand">${esc(p.brand || p.subcategory || p.category)}</span>
          <h3 class="name"><a href="${pdp(p)}">${esc(p.name)}</a></h3>
          <div class="price"><b>${p.price ? rupees(p.price) : "Price on request"}</b>${off ? `<s>${rupees(p.mrp)}</s><em>(${off}% off)</em>` : ""}</div>
          ${meta ? `<span class="meta">${meta}</span>` : ""}
          ${window.VXOrder.button(p)}
        </div>
      </article>`;
  }

  // ---- category pills under the header ----
  function renderCatTabs() {
    const fresh = products.filter(isNew).length;
    const tabs = [
      fresh ? `<button class="cat-tab hl" data-jump="New"><i>${fresh} new</i>New in</button>` : "",
      `<button class="cat-tab" data-jump="All">Shop all</button>`,
      ...CATS.filter((c) => products.some((p) => p.category === c)).map((c) => `<button class="cat-tab" data-jump="${c}">${c}</button>`),
      products.some((p) => p.price && p.price < 2000 && p.status === "available") ? `<button class="cat-tab" data-band="u2000">Under ₹2,000</button>` : "",
      products.some((p) => offPct(p) >= 40) ? `<button class="cat-tab" data-jump="Deals">40%+ off</button>` : "",
    ];
    $("cat-tabs").innerHTML = `<div class="cat-tabs-in">${tabs.join("")}</div>`;
  }

  // ---- banner slider, built from real photos ----
  let slideTimer = null;
  function renderSlider() {
    const photos = (list) => list.filter((p) => p.image && p.status === "available");
    const byNew = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);
    const all = photos(products).sort(byNew);
    const slides = [];
    if (all.length) slides.push({ kicker: "The Surplus Store · Srinagar", title: "World brands.<br>One destination.", cta: "Shop new in", jump: "New", imgs: all.slice(0, 3) });
    for (const c of CATS) {
      const list = photos(products.filter((p) => p.category === c)).sort(byNew);
      const total = products.filter((p) => p.category === c && p.status !== "sold").length;
      if (list.length) slides.push({ kicker: `${total} pieces in`, title: esc(c), sub: BLURB[c], cta: `Shop ${c.toLowerCase()}`, jump: c, imgs: list.slice(0, 3) });
    }
    const el = $("slider");
    el.hidden = !slides.length;
    if (!slides.length) return;
    $("slides").innerHTML = slides.map((s, i) => `
      <div class="slide" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${slides.length}">
        <div class="slide-pics n${s.imgs.length}">${s.imgs.map((p, j) => `<img src="${esc(p.image)}" alt="" ${i === 0 && j === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`).join("")}</div>
        <div class="slide-copy">
          <p>${esc(s.kicker)}</p>
          <h2>${s.title}</h2>
          ${s.sub ? `<span>${esc(s.sub)}</span>` : ""}
          <a class="btn btn-white" href="#rack" data-jump="${s.jump}">${esc(s.cta)}</a>
        </div>
      </div>`).join("");
    $("slider-dots").innerHTML = slides.length > 1 ? slides.map((_, i) => `<button type="button" aria-label="Slide ${i + 1}" data-slide="${i}"${i ? "" : ' aria-current="true"'}></button>`).join("") : "";
    const track = $("slides");
    const go = (i) => track.scrollTo({ left: i * track.clientWidth, behavior: "smooth" });
    const cur = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    const mark = () => {
      const i = cur();
      $("slider-dots").querySelectorAll("button").forEach((b, j) => b.toggleAttribute("aria-current", j === i));
      track.querySelectorAll(".slide").forEach((s, j) => s.classList.toggle("on", j === i)); // its text rises in
    };
    track.onscroll = mark;
    requestAnimationFrame(mark);
    $("slider-dots").onclick = (e) => { const b = e.target.closest("[data-slide]"); if (b) { go(+b.dataset.slide); restart(); } };
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    function restart() {
      clearInterval(slideTimer);
      // hold the first slide while the opening map is up, and for a full turn after it lifts
      let introGone = document.querySelector(".vxi") ? 0 : 1;
      if (slides.length > 1 && !reduce) slideTimer = setInterval(() => {
        if (document.querySelector(".vxi")) { introGone = 0; return; }
        if (introGone === 0) { introGone = Date.now(); return; }            // the map just lifted: give slide 1 a full turn
        if (introGone > 1 && Date.now() - introGone < 4000) return;
        go((cur() + 1) % slides.length);
      }, 5500);
    }
    track.onpointerdown = restart;
    restart();
  }

  // ---- "Shop our range": category + style tiles ----
  function renderRange() {
    const tiles = [];
    for (const c of CATS) {
      const list = products.filter((p) => p.category === c);
      if (!list.length) continue;
      tiles.push({ label: c, n: list.length, p: list.find((p) => p.image) || list[0], jump: c });
      const subs = {};
      for (const p of list) if (p.subcategory && p.subcategory.toLowerCase() !== c.toLowerCase()) (subs[p.subcategory] ||= []).push(p);
      // a style that is the whole category (every fragrance is a "Perfume") would just repeat it
      for (const [s, items] of Object.entries(subs).filter(([, items]) => items.length < list.length).sort((a, b) => b[1].length - a[1].length).slice(0, 3)) {
        tiles.push({ label: s, n: items.length, p: items.find((p) => p.image) || items[0], jump: c, sub: s });
      }
    }
    $("range").innerHTML = tiles.map((t) => `
      <button type="button" class="range-tile" data-jump="${esc(t.jump)}"${t.sub ? ` data-sub="${esc(t.sub)}"` : ""}>
        <span class="range-pic ${t.p.image ? "" : "art-bg"}">${pic(t.p)}</span>
        <span class="range-name">${esc(t.label)}</span><span class="range-n">${t.n} ${t.n === 1 ? "piece" : "pieces"}</span>
      </button>`).join("");
    $("range").parentElement.hidden = tiles.length < 2;
  }

  // ---- shop by size / price / brand ----
  const sizesOf = (p) => (p.category === "Clothing" && p.sizes ? String(p.sizes).toUpperCase().split(/\s*[·,/|]\s*|\s+/).filter((s) => SIZE_ORDER.includes(s)) : []);
  function renderShopBy() {
    const live = products.filter((p) => p.status !== "sold");
    const sizes = {};
    for (const p of live) for (const s of sizesOf(p)) sizes[s] = (sizes[s] || 0) + 1;
    const sz = SIZE_ORDER.filter((s) => sizes[s]);
    $("sizes").innerHTML = sz.map((s) => `<button type="button" class="pill${view.size === s ? " on" : ""}" data-size="${s}">${s}</button>`).join("");
    $("by-size").hidden = !sz.length;
    const bands = BANDS.filter((b) => live.some((p) => p.price && b.test(p.price)));
    $("prices").innerHTML = bands.map((b) => `<button type="button" class="pill${view.band === b.id ? " on" : ""}" data-band="${b.id}">${b.label}</button>`).join("");
    $("by-price").hidden = !bands.length;
    const brands = {};
    for (const p of live) if (p.brand) brands[p.brand] = (brands[p.brand] || 0) + 1;
    const names = Object.keys(brands).sort((a, b) => brands[b] - brands[a] || a.localeCompare(b));
    $("brands").innerHTML = names.map((b) => `<button type="button" class="pill${view.brand === b ? " on" : ""}" data-brand="${esc(b)}">${esc(b)}<sup>${brands[b]}</sup></button>`).join("");
    $("by-brand").hidden = names.length < 3;
  }

  // ---- "Just landed": one big photo + six small, like a lookbook grid ----
  function renderLooks() {
    const list = products.filter((p) => p.image && p.status === "available").sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 7);
    $("looks-sec").hidden = list.length < 4;
    if (list.length < 4) return;
    const tile = (p, big) => `<a class="look${big ? " big" : ""}" href="${pdp(p)}"><img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" decoding="async">
      <span><b>${esc(p.name)}</b>${p.price ? rupees(p.price) : ""}</span></a>`;
    $("looks").innerHTML = tile(list[0], true) + `<div class="looks-small">${list.slice(1).map((p) => tile(p)).join("")}</div>`;
    // store photo: four pieces from the rack
    $("store-pic").innerHTML = list.slice(0, 4).map((p) => `<img src="${esc(p.image)}" alt="" loading="lazy">`).join("") + `<span>Khanyaar, Srinagar</span>`;
  }

  // ---- the rack ----
  const sortRack = (a, b) => (a.status === "sold") - (b.status === "sold") || (a.status === "hold") - (b.status === "hold") || new Date(b.createdAt) - new Date(a.createdAt);
  function inView(p) {
    if (view.tab === "New" && !isNew(p)) return false;
    if (view.tab === "Deals" && offPct(p) < 40) return false;
    if (CATS.includes(view.tab) && p.category !== view.tab) return false;
    if (view.sub && p.subcategory !== view.sub) return false;
    if (view.size && !sizesOf(p).includes(view.size)) return false;
    if (view.band) {
      const b = BANDS.find((x) => x.id === view.band);
      if (view.band === "u2000") { if (!(p.price && p.price < 2000)) return false; }
      else if (!b || !p.price || !b.test(p.price)) return false;
    }
    if (view.brand && p.brand !== view.brand) return false;
    return true;
  }

  function renderTabs() {
    const tabs = ["All", "New", ...CATS.filter((c) => products.some((p) => p.category === c))];
    if (view.tab === "Deals") tabs.push("Deals");
    $("filters").innerHTML = tabs.map((t) => {
      const n = t === "All" ? products.length : t === "New" ? products.filter(isNew).length : t === "Deals" ? products.filter((p) => offPct(p) >= 40).length : products.filter((p) => p.category === t).length;
      if (t === "New" && !n) return "";
      const label = t === "All" ? "All" : t === "New" ? "New in" : t === "Deals" ? "40%+ off" : t;
      return `<button role="tab" aria-selected="${t === view.tab}" data-tab="${t}">${label}<sup>${n}</sup></button>`;
    }).join("");
  }

  function renderSubs() {
    const el = $("subs");
    if (!CATS.includes(view.tab)) { el.hidden = true; el.innerHTML = ""; return; }
    const counts = {};
    for (const p of products) if (p.category === view.tab && p.subcategory) counts[p.subcategory] = (counts[p.subcategory] || 0) + 1;
    const names = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    if (names.length < 2) { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;
    el.innerHTML = [`<button data-sub="" aria-pressed="${!view.sub}">All ${esc(view.tab.toLowerCase())}</button>`]
      .concat(names.map((n) => `<button data-sub="${esc(n)}" aria-pressed="${view.sub === n}">${esc(n)}<sup>${counts[n]}</sup></button>`)).join("");
  }

  function renderActive() {
    const chips = [];
    if (view.size) chips.push(["size", `Size ${view.size}`]);
    if (view.band) chips.push(["band", view.band === "u2000" ? "Under ₹2,000" : BANDS.find((b) => b.id === view.band)?.label]);
    if (view.brand) chips.push(["brand", view.brand]);
    $("active").hidden = !chips.length;
    $("active").innerHTML = chips.map(([k, l]) => `<button type="button" data-clear="${k}">${esc(l)} <span aria-hidden="true">×</span></button>`).join("") + (chips.length ? `<button type="button" class="clear-all" data-clear="all">Clear all</button>` : "");
  }

  // Cards are kept between live updates and only rebuilt when that product changed, so
  // photos never reload or go blank on phones.
  const cardCache = new Map();
  function renderGrid(fresh = new Set()) {
    const list = products.filter(inView).sort(sortRack);
    const shown = list.slice(0, view.shown);
    const grid = document.createElement("div");
    grid.className = "grid";
    shown.forEach((p, i) => {
      const sig = card(p, fresh.has(p.id)); // the rack is below the first screen: photos load as it nears
      let hit = cardCache.get(p.id);
      if (!hit || hit.sig !== sig) {
        const t = document.createElement("template");
        t.innerHTML = sig.trim();
        hit = { sig, el: t.content.firstElementChild };
        cardCache.set(p.id, hit);
      }
      hit.el.classList.toggle("fresh", fresh.has(p.id));
      grid.appendChild(hit.el);
    });
    const byId = new Set(products.map((p) => p.id));
    for (const id of cardCache.keys()) if (!byId.has(id)) cardCache.delete(id);
    $("grid").replaceChildren(...(shown.length ? [grid] : []));
    $("empty").hidden = shown.length > 0;
    $("more").hidden = list.length <= view.shown;
    $("count").textContent = list.length ? `Showing ${shown.length} of ${list.length}` : "";
    renderTabs();
    renderSubs();
    renderActive();
    renderShopBy();
    document.querySelectorAll(".cat-tab").forEach((b) => b.classList.toggle("on", b.dataset.jump === view.tab && !view.band || (b.dataset.band && view.band === b.dataset.band)));
  }

  function setView(patch, scroll) {
    Object.assign(view, patch, { shown: PAGE });
    renderGrid();
    if (scroll) $("rack").scrollIntoView({ behavior: "smooth" });
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
      renderCatTabs();
      renderRange();
      renderLooks();
      if (first || fresh.size) renderSlider();
      if (first) renderTicker();
      if (fresh.size) {
        const p = next.find((x) => fresh.has(x.id));
        toast(`<b>New drop</b><span>${esc(p.name)}${p.price ? ` · ${rupees(p.price)}` : ""}</span><button type="button" class="toast-go" data-goto="${esc(p.id)}">See it</button>`);
      }
    } catch { /* server restarting; next tick retries */ }
  }

  // ---- clicks ----
  document.addEventListener("click", (e) => {
    const jump = e.target.closest("[data-jump]");
    if (jump) {
      e.preventDefault();
      const tab = jump.dataset.jump;
      setView({ tab, sub: jump.dataset.sub || null, size: null, band: null, brand: null }, true);
      return;
    }
    const band = e.target.closest("[data-band]");
    if (band) {
      const v = band.dataset.band;
      setView({ band: view.band === v ? null : v, ...(v === "u2000" ? { tab: "All", sub: null } : {}) }, true);
      return;
    }
    const size = e.target.closest("[data-size]");
    if (size) { setView({ size: view.size === size.dataset.size ? null : size.dataset.size, tab: view.tab === "All" || view.tab === "New" ? view.tab : "Clothing" }, true); return; }
    const brand = e.target.closest("[data-brand]");
    if (brand) { setView({ brand: view.brand === brand.dataset.brand ? null : brand.dataset.brand }, true); return; }
    const clr = e.target.closest("[data-clear]");
    if (clr) { const k = clr.dataset.clear; setView(k === "all" ? { size: null, band: null, brand: null } : { [k]: null }); return; }
    const goto = e.target.closest("[data-goto]");
    if (goto) {
      setView({ tab: "All", sub: null, size: null, band: null, brand: null });
      const el = document.querySelector(`.card[data-id="${CSS.escape(goto.dataset.goto)}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      $("toast").hidden = true;
      return;
    }
    if (e.target.closest('[data-dock="home"]')) { e.preventDefault(); scrollTo({ top: 0, behavior: "smooth" }); }
  });
  $("filters").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]");
    if (b) setView({ tab: b.dataset.tab, sub: null });
  });
  $("subs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-sub]");
    if (b) setView({ sub: b.dataset.sub || null });
  });
  $("more").addEventListener("click", () => { view.shown += PAGE; renderGrid(); });

  window.VXOrder.install((id) => products.find((p) => p.id === id));

  // ---- phone dock: hides while scrolling down, comes back on the way up ----
  let lastY = scrollY;
  addEventListener("scroll", () => {
    const y = scrollY;
    $("dock").classList.toggle("away", y > lastY && y > 200);
    lastY = y;
  }, { passive: true });

  // ---- "Just sold" note: only real sales, no buyer details ----
  const SEEN_KEY = "vx-sales-seen";
  let seen = new Set();
  try { seen = new Set(JSON.parse(sessionStorage.getItem(SEEN_KEY) || "[]")); } catch { /* private mode */ }
  let shownThisVisit = 0;
  const saleKey = (s) => `${s.id}@${s.at}`;
  function showSale() {
    const t = $("toast");
    if (!t.hidden || shownThisVisit >= 3) return;
    const s = sales.find((x) => !seen.has(saleKey(x)));
    if (!s) return;
    seen.add(saleKey(s));
    try { sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen])); } catch { /* fine */ }
    shownThisVisit++;
    const fresh = Date.now() - new Date(s.at) < 3600e3;
    toast(`<b>Sold</b><span>Someone ${fresh ? "just " : ""}bought ${esc(s.name)}${s.qty > 1 ? ` (×${s.qty})` : ""}${agoAt(s.at) === "just now" ? "" : ` · ${agoAt(s.at)}`}</span>`);
  }
  let salesJson = "";
  async function refreshSales() {
    try {
      const res = await fetch("/api/recent-sales", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.text();
      if (json === salesJson) return;
      salesJson = json;
      sales = JSON.parse(json);
      if (products.length) renderGrid();
    } catch { /* server restarting */ }
  }
  refreshSales().then(() => setTimeout(showSale, 6000));
  setInterval(refreshSales, 15000);
  setInterval(showSale, 30000);

  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  addEventListener("pageshow", (e) => { if (e.persisted) refresh(); });
  addEventListener("focus", refresh);

  refresh();
  setInterval(refresh, 2000);
})();
