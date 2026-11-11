// Vibe X homepage, v5 (department-store layout: category pills, dense grid,
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
  const view = { tab: "All", sub: null, size: null, band: null, brand: null, q: null, shown: PAGE };
  const SR = window.VXSearch;
  let moreLeft = false, holdLoad = 0;
  // Back from a product page: same number of pieces, so the customer lands where they were.
  const SHOWN_KEY = "vx-shown";
  try {
    if (performance.getEntriesByType("navigation")[0]?.type === "back_forward") view.shown = Math.max(PAGE, Number(sessionStorage.getItem(SHOWN_KEY)) || PAGE);
  } catch { /* private mode */ }
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

  // Trust strip. Once the owner has agreed the policy pages (shop.json -> policy.confirmed), it is the
  // shop's own promises, each one a link to where it is written down. Until then, the confirmed
  // numbers (claims.stats). Nothing here that isn't on the Returns page or true of the store.
  const P = S.policy || {};
  const stats = P.confirmed ? [
    { big: "100% original", small: "or your money back", href: "/returns" },
    P.photoBeforeDispatch && { big: "See it first", small: "photo on WhatsApp before dispatch", href: "/returns" },
    P.changeOfMindDays && { big: `${P.changeOfMindDays}-day returns`, small: "if you change your mind", href: "/returns" },
    { big: "A real store", small: "Khanyaar, Srinagar", href: "#visit" },
  ].filter(Boolean) : ((S.claims && S.claims.stats) || []).map((x) => ({ ...x, href: /store|srinagar/i.test(`${x.big} ${x.small}`) ? "#visit" : "" }));
  $("stats").innerHTML = stats.map((x, i) => `<div><span class="trust-no">${String(i + 1).padStart(2, "0")}</span>${x.href ? `<a class="trust-link" href="${x.href}">` : ""}<p><b>${esc(x.big)}</b><span>${esc(x.small)}</span></p>${x.href ? "</a>" : ""}</div>`).join("");
  $("stats").hidden = !stats.length;
  $("stats").style.setProperty("--n", Math.max(1, stats.length));
  // Under the headline: the one big number the owner confirmed (claims.orders), in a sentence.
  const O = S.claims && S.claims.orders;
  if (O && $("proof")) {
    $("proof").innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l7.5 3v5.6c0 4.600-3.100 8.300-7.500 10.400-4.400-2.100-7.500-5.800-7.500-10.400V5.500z"/><path d="M8.300 12.200l2.600 2.600 4.800-5.200"/></svg><span><b>${esc(O.label)} ${esc(O.small)}</b> from our store in Srinagar to all of India</span>`;
    $("proof").hidden = false;
  }

  // ---- latest YouTube video: a plain picture until someone presses play, so YouTube's player
  // (about 1 MB of scripts) costs nothing on a normal visit. The server picks the video. ----
  const YT_ORIGIN = "https://www.youtube-nocookie.com";
  const playerTell = (f) => (func, args = []) => f.contentWindow.postMessage(JSON.stringify({ event: "command", func, args }), YT_ORIGIN);
  let videoPlaying = false;

  // Sound from something you can't see, with no way to stop it, is the worst of embedded video:
  // pause once it has mostly left the screen, and carry on when it comes back. Only if we were the
  // ones who paused it: a video the customer stopped stays stopped.
  function followPlayer(f, frame) {
    const tell = playerTell(f);
    let pausedByScroll = false;
    videoPlaying = true; // it was asked to autoplay; the player corrects this if not
    addEventListener("message", (e) => {
      if (e.origin !== YT_ORIGIN || e.source !== f.contentWindow) return;
      let data; try { data = JSON.parse(e.data); } catch { return; }
      const state = data?.info?.playerState;
      if (typeof state === "number") videoPlaying = state === 1 || state === 3; // playing, buffering
    });
    f.addEventListener("load", () => f.contentWindow.postMessage(JSON.stringify({ event: "listening", id: "vx", channel: "widget" }), YT_ORIGIN));
    new IntersectionObserver(([e]) => {
      if (!e.isIntersecting && videoPlaying) { pausedByScroll = true; tell("pauseVideo"); }
      else if (e.isIntersecting && pausedByScroll) { pausedByScroll = false; tell("playVideo"); }
    }, { threshold: .4 }).observe(frame);
  }

  function renderVideo() {
    const v = S.latestVideo, Y = S.youtube || {}, sec = $("latest");
    if (!sec || !v) return;
    const frame = $("vid-frame"), btn = $("vid-btn"), img = $("vid-img");
    if (v.thumbBig) { img.srcset = `${v.thumb} 640w, ${v.thumbBig} 1280w`; img.sizes = "(max-width: 760px) 213px, 60vw"; } // phones always take the 70 KB picture, even at 3x
    img.src = v.thumb;
    frame.classList.toggle("is-short", v.short);
    btn.setAttribute("aria-label", `Play video: ${v.title}`);
    $("vid-title").textContent = v.headline;
    const when = v.published ? new Date(v.published).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
    $("vid-tag").textContent = ["New on YouTube", when].filter(Boolean).join(" · ");
    $("vid-more").href = Y.channel || `https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}`;
    sec.hidden = false;

    const warm = () => {
      const l = document.createElement("link");
      l.rel = "preconnect"; l.href = "https://www.youtube-nocookie.com";
      document.head.append(l);
    };
    btn.addEventListener("pointerenter", warm, { once: true });
    btn.addEventListener("touchstart", warm, { once: true, passive: true });
    btn.addEventListener("click", () => {
      const f = document.createElement("iframe");
      f.title = v.title;
      f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      f.allowFullscreen = true;
      f.referrerPolicy = "strict-origin-when-cross-origin"; // YouTube refuses to play without it
      // Phones and Safari won't let a tap out here start sound in YouTube's frame: unmuted, the
      // first tap would seem to do nothing. So they start silent, straight away.
      const quiet = /Mobi|Android/.test(navigator.userAgent) || navigator.vendor.includes("Apple");
      f.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?autoplay=1&rel=0&playsinline=1&enablejsapi=1${quiet ? "&mute=1" : ""}`;
      btn.replaceWith(f);
      f.focus();
      followPlayer(f, frame);
      if (!quiet) return;
      const sound = document.createElement("button");
      sound.type = "button"; sound.className = "vid-sound"; sound.textContent = "Tap for sound";
      const tell = playerTell(f);
      sound.addEventListener("click", () => { tell("unMute"); tell("setVolume", [100]); tell("playVideo"); sound.remove(); });
      frame.append(sound);
    }, { once: true });
  }
  renderVideo();

  // ---- what customers wrote to the shop ----
  (() => { const html = window.VXOrder.reviews(); if (html) { $("rv-body").innerHTML = html; $("reviews").hidden = false; } })();

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
    if (hasOffer(p)) out.push(offBadge(p));
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
  const manyPrices = (p) => new Set((p.options || []).map((o) => o.price)).size > 1;
  const hasOffer = (p) => offPct(p) > 0 && !manyPrices(p) && p.status === "available";
  const offBadge = (p) => `<span class="badge badge-off">${offPct(p)}% OFF</span>`;
  const wasPrice = (p) => (hasOffer(p) ? ` <s>${rupees(p.mrp)}</s>` : "");
  function card(p, eager) {
    const off = offPct(p);
    const meta = [p.sizes, p.status === "sold" && soldAt(p) ? `Sold ${agoAt(soldAt(p))}` : null].filter(Boolean).map(esc).join(" · ");
    return `
      <article class="card${p.status === "sold" ? " sold" : ""}" data-id="${esc(p.id)}"${window.VXPhotos.alt(p)}>
        <div class="media ${p.image ? "" : "art-bg"}">${pic(p, eager)}<a class="cover" href="${pdp(p)}" aria-label="${esc(p.name)}"></a>
          ${badges(p)}${window.VXPhotos.badge(p)}
          ${p.status === "sold" ? `<div class="sold-stamp"><span>Sold out</span></div>` : ""}
          ${p.status === "hold" ? `<div class="sold-stamp hold-stamp"><span>On hold</span></div>` : ""}
          ${window.VXOrder.quick(p)}
        </div>
        <div class="info">
          <span class="brand">${esc(p.brand || p.subcategory || p.category)}</span>
          <h3 class="name"><a href="${pdp(p)}">${esc(p.name)}</a></h3>
          <div class="price"><b>${p.price ? `${manyPrices(p) ? "From " : ""}${rupees(p.price)}` : "Price on request"}</b>${off && !manyPrices(p) ? `<s>${rupees(p.mrp)}</s><em>(${off}% off)</em>` : ""}</div>
          ${meta ? `<span class="meta">${meta}</span>` : ""}
        </div>
      </article>`;
  }

  // ---- category pills under the header ----
  // Hero numbers: counted from the rack right now, so they are always true.
  // The hero's latest posts: newest real pieces, one line each, no repeats of a name.
  function renderHeroFeed() {
    const box = $("hl-feed");
    const seen = new Set();
    const list = products.filter((p) => p.image && p.status === "available" && !seen.has(p.name) && seen.add(p.name))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 3);
    box.hidden = !list.length;
    box.innerHTML = list.length ? `<span>Just posted</span>` + list.map((p) => `
      <a class="hl-post" href="${pdp(p)}"><img src="${esc(p.image)}" alt="" loading="lazy" decoding="async">
        <span><b>${esc(p.name)}</b><em>${esc(agoAt(p.createdAt))}</em></span>
        <i>${p.price ? `${manyPrices(p) ? "From " : ""}${rupees(p.price)}` : ""}</i></a>`).join("") : "";
  }

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
    // No category link may lead to an empty rack: the header, phone menu and footer are fixed HTML.
    for (const c of CATS) document.querySelectorAll(`a[data-jump="${c}"]`).forEach((a) => { a.style.display = products.some((p) => p.category === c) ? "" : "none"; });
  }

  // ---- The drop: the hero's rotating piece. The brand's MRP shown big, slashed, and our price
  // landing in its place. Only pieces whose MRP the owner entered; the freshest fill any gap.
  // Stories-style bars on top: it moves on by itself, a tap on a bar or a swipe moves it by hand. ----
  const DROP = 5;
  function dropPicks() {
    const ok = products.filter((p) => p.image && p.status === "available" && p.price);
    const picks = [], perBrand = {};
    const take = (p) => {
      const b = (p.brand || p.name.split(" ")[0]).toLowerCase();
      if (picks.length >= DROP || picks.some((x) => x.name === p.name) || (perBrand[b] || 0) >= 2) return;
      perBrand[b] = (perBrand[b] || 0) + 1;
      picks.push(p);
    };
    ok.filter(hasOffer).sort((a, b) => (b.mrp - b.price) - (a.mrp - a.price)).forEach(take);
    if (picks.length < 3) ok.filter((p) => !hasOffer(p)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).forEach(take);
    // No two of a label in a row, where that can be helped.
    const brandOf = (p) => (p.brand || p.name.split(" ")[0]).toLowerCase(), out = [];
    while (picks.length) {
      const left = (p) => picks.filter((x) => brandOf(x) === brandOf(p)).length; // the label with most still to show goes next
      const free = picks.filter((p) => !out.length || brandOf(p) !== brandOf(out[out.length - 1]));
      const next = free.sort((a, b) => left(b) - left(a))[0] || picks[0];
      out.push(picks.splice(picks.indexOf(next), 1)[0]);
    }
    return out;
  }
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let dropKey = "", dropAt = 0, dropSeen = null, dropRoll = 0;
  function renderDrop() {
    const box = $("drop");
    if (!box) return;
    const list = dropPicks();
    box.hidden = !list.length;
    const key = list.map((p) => `${p.id}:${p.price}:${p.mrp}:${p.quantity}:${p.image}`).join();
    if (key === dropKey) return;
    dropKey = key;
    if (!list.length) { box.innerHTML = ""; return; }
    dropAt = Math.min(dropAt, list.length - 1);
    const many = list.length > 1;
    const low = (p) => (p.quantity >= 2 && p.quantity <= 3 ? `Only ${p.quantity} left` : p.quantity === 1 && soldAt(p) ? "Last one" : "");
    box.innerHTML = `
      <div class="drop-top"><span class="drop-label"><span class="dot"></span>${list.some(hasOffer) ? "MRP vs our price" : "Just unpacked"}</span>
        ${many ? `<div class="drop-bars">${list.map((p, i) => `<button type="button" data-drop="${i}" aria-label="Piece ${i + 1} of ${list.length}"><i></i></button>`).join("")}</div>` : ""}</div>
      <div class="drop-stage">${list.map((p, i) => `
        <a class="drop-card" href="${pdp(p)}" data-i="${i}">
          <span class="drop-pic"><img ${i === dropAt ? "src" : "data-src"}="${esc(p.image)}" alt="${esc(p.name)}" decoding="async"${i === dropAt ? ` fetchpriority="high"` : ""}>${hasOffer(p) ? `<span class="drop-off">${offPct(p)}% off</span>` : ""}</span>
          <span class="drop-info">
            <span class="drop-brand">${esc(p.brand && p.brand !== p.name ? p.brand : p.category)}${low(p) ? `<i>${low(p)}</i>` : ""}</span>
            <b class="drop-name">${esc(p.name)}</b>
            ${hasOffer(p) ? `<span class="drop-mrp drop-was"><em>MRP</em><s>${rupees(p.mrp)}</s></span>` : `<span class="drop-mrp">Posted ${esc(agoAt(p.createdAt))}</span>`}
            <span class="drop-price${hasOffer(p) ? " drop-cut" : ""}">${hasOffer(p) ? `<span class="drop-big" aria-hidden="true"><i class="a">${rupees(p.mrp)}</i><i class="b">${rupees(p.mrp)}</i><u><b></b></u></span>` : ""}<span class="drop-now" data-from="${hasOffer(p) ? p.mrp : p.price}" data-to="${p.price}">${rupees(p.price)}</span></span>
            ${hasOffer(p) ? `<span class="drop-save">You save ${rupees(p.mrp - p.price)}</span>` : p.sizes ? `<span class="drop-size">${esc(p.sizes)}</span>` : ""}
            <span class="drop-go">See this piece <span aria-hidden="true">→</span></span>
          </span>
        </a>`).join("")}</div>`;
    const cards = [...box.querySelectorAll(".drop-card")], bars = [...box.querySelectorAll(".drop-bars button")];
    const load = (i) => { const img = cards[i]?.querySelector("img[data-src]"); if (img) { img.src = img.dataset.src; img.removeAttribute("data-src"); } };
    // The MRP stands big as the price, a red blade cuts it in two, the halves fall away and ours lands in
    // its place (shop.css, replayed each time a card comes on). Our price then counts down from the MRP.
    const roll = (card) => {
      const el = card.querySelector(".drop-now"), from = Number(el.dataset.from), to = Number(el.dataset.to);
      cancelAnimationFrame(dropRoll);
      if (calm || from === to) { el.textContent = rupees(to); return; }
      const t0 = performance.now(), wait = 1420, ms = 750;
      el.textContent = rupees(from);
      const step = (now) => {
        const k = Math.min(1, Math.max(0, (now - t0 - wait) / ms)), e = 1 - Math.pow(1 - k, 3);
        el.textContent = rupees(k < 1 ? Math.round((from - (from - to) * e) / 10) * 10 : to);
        if (k < 1) dropRoll = requestAnimationFrame(step);
      };
      dropRoll = requestAnimationFrame(step);
    };
    const show = (i) => {
      dropAt = (i + list.length) % list.length;
      load(dropAt);
      cards.forEach((c, n) => {
        const on = n === dropAt;
        c.classList.remove("on"); if (on) { void c.offsetWidth; c.classList.add("on"); }
        c.tabIndex = on ? 0 : -1; c.setAttribute("aria-hidden", on ? "false" : "true");
      });
      bars.forEach((b, n) => { b.classList.remove("on"); b.classList.toggle("done", n < dropAt); if (n === dropAt) { void b.offsetWidth; b.classList.add("on"); } });
      roll(cards[dropAt]);
      load((dropAt + 1) % list.length); // the next photo is ready before its turn
    };
    box.onclick = (e) => {
      const b = e.target.closest("[data-drop]");
      if (b) show(Number(b.dataset.drop));
      else if (box.dataset.swiped) { e.preventDefault(); delete box.dataset.swiped; }
    };
    box.onanimationend = (e) => { if (e.animationName === "dropbar") show(dropAt + 1); };
    // A sideways swipe changes the piece; up and down still scrolls the page.
    let sx = 0, sy = 0;
    box.ontouchstart = (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; delete box.dataset.swiped; box.classList.add("held"); };
    box.ontouchend = (e) => {
      box.classList.remove("held");
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (many && Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(dy) * 1.4) { box.dataset.swiped = "1"; show(dropAt + (dx < 0 ? 1 : -1)); setTimeout(() => delete box.dataset.swiped, 400); }
    };
    box.ontouchcancel = () => box.classList.remove("held");
    // Stands still while off screen, so nothing runs for a customer who is down in the rack.
    if (!dropSeen) {
      dropSeen = new IntersectionObserver(([e]) => box.classList.toggle("away", !e.isIntersecting), { threshold: .35 });
      dropSeen.observe(box);
    }
    show(dropAt);
    const root = document.documentElement;
    if (root.classList.contains("vx-pre")) new MutationObserver((_, o) => { if (!root.classList.contains("vx-pre")) { o.disconnect(); show(dropAt); } }).observe(root, { attributeFilter: ["class"] });
  }

  // ---- Featured, above the rack: pieces ticked in the portal, then the priciest in stock.
  // Skips repeats of a name (several Tender Ambers). ----
  const FEATURED = 6;
  let featKey = "", featTimer = null, featSeen = null;
  function renderFeatured() {
    const box = $("feat");
    if (!box) return;
    const ok = products.filter((p) => p.image && p.status === "available");
    const chosen = ok.filter((p) => p.featured);
    const rest = ok.filter((p) => !p.featured).sort((a, b) => (b.price || 0) - (a.price || 0));
    const picks = [...chosen];
    const up = dropPicks(); // already in the hero just above: Featured shows different pieces
    for (const skip of [true, false]) for (const p of rest) {
      if (picks.length >= FEATURED) break;
      if (picks.includes(p) || picks.some((x) => x.name === p.name) || (skip && up.some((x) => x.id === p.id || x.name === p.name))) continue;
      picks.push(p);
    }
    const list = picks.slice(0, FEATURED);
    box.hidden = !list.length;
    const key = list.map((p) => `${p.id}:${p.price}:${window.VXPhotos.list(p).join("|")}`).join();
    if (key === featKey) return; // this runs on every stock change: don't throw the customer back to slide 1
    featKey = key;
    const track = $("feat-track"), count = $("feat-count");
    const many = list.length > 1;
    track.innerHTML = list.map((p, i) => `
      <a class="feat-slide" href="${pdp(p)}" aria-label="${esc(p.name)}, ${i + 1} of ${list.length}"${window.VXPhotos.alt(p)}>
        <span class="feat-pic"><img src="${esc(p.image)}" alt="" loading="lazy" decoding="async">${hasOffer(p) ? `<span class="feat-off">${offBadge(p)}</span>` : ""}${window.VXPhotos.badge(p)}</span>
        <span class="feat-cap"><span>${esc(p.brand && p.brand !== p.name ? p.brand : p.category)}</span><b>${esc(p.name)}</b><em>${p.price ? `${manyPrices(p) ? "From " : ""}${rupees(p.price)}` : "Price on request"}${wasPrice(p)}</em></span>
      </a>`).join("");
    $("feat-prev").hidden = $("feat-next").hidden = !many;
    const step = () => track.firstElementChild?.getBoundingClientRect().width + parseFloat(getComputedStyle(track).columnGap || 0) || 1;
    const cur = () => Math.round(track.scrollLeft / step());
    const mark = () => { count.textContent = many ? `${String(Math.min(cur(), list.length - 1) + 1).padStart(2, "0")} / ${String(list.length).padStart(2, "0")}` : ""; };
    const atEnd = () => track.scrollLeft + track.clientWidth >= track.scrollWidth - 2; // several show at once, so the last few can't reach the left edge
    const go = (i) => track.scrollTo({ left: ((i + list.length) % list.length) * step(), behavior: "smooth" });
    track.onscroll = mark; mark();
    $("feat-prev").onclick = () => go(cur() - 1);
    $("feat-next").onclick = () => go(atEnd() ? 0 : cur() + 1);
    // Moves on its own only on desktop, on screen, and when nobody is busy with it
    // or watching the video. Phones show the next piece peeking in, and swipe.
    clearInterval(featTimer);
    if (!many || matchMedia("(prefers-reduced-motion: reduce)").matches || !matchMedia("(min-width: 761px)").matches) return;
    if (!featSeen) { featSeen = { now: false }; new IntersectionObserver(([e]) => { featSeen.now = e.isIntersecting; }, { threshold: .5 }).observe(box); }
    // :focus-visible, not :focus-within: a clicked arrow keeps focus, which would stop it for good
    featTimer = setInterval(() => {
      if (featSeen.now && !videoPlaying && !box.matches(":hover") && !box.querySelector(":focus-visible") && !document.hidden) go(atEnd() ? 0 : cur() + 1);
    }, 5500);
  }

  // ---- shop by size / price / brand ----
  const sizesOf = (p) => (p.options || []).filter((o) => o.left !== 0).map((o) => o.size.toUpperCase()).filter((s) => SIZE_ORDER.includes(s) || /^[\d.]+ ML$/.test(s));
  const sizeLabel = (s) => s.replace(/ ML$/, " ml");
  function renderShopBy() {
    const live = products.filter((p) => p.status !== "sold");
    const sizes = {};
    for (const p of live) for (const s of sizesOf(p)) sizes[s] = (sizes[s] || 0) + 1;
    const sz = [...SIZE_ORDER.filter((s) => sizes[s]), ...Object.keys(sizes).filter((s) => / ML$/.test(s)).sort((a, b) => parseFloat(a) - parseFloat(b))];
    $("sizes").innerHTML = sz.map((s) => `<button type="button" class="pill${view.size === s ? " on" : ""}" data-size="${s}">${sizeLabel(s)}</button>`).join("");
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
    const tile = (p, big) => `<a class="look${big ? " big" : ""}" href="${pdp(p)}"${window.VXPhotos.alt(p)}><img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" decoding="async">${window.VXPhotos.badge(p)}
      <span><b>${esc(p.name)}</b>${p.price ? rupees(p.price) : ""}</span></a>`;
    $("looks").innerHTML = tile(list[0], true) + `<div class="looks-small">${list.slice(1).map((p) => tile(p)).join("")}</div>`;
    // store photo: four pieces from the rack
    $("store-pic").innerHTML = list.slice(0, 4).map((p) => `<a href="${pdp(p)}"><img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy"></a>`).join("") + `<span>Khanyaar, Srinagar</span>`;
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
    if (view.q && !SR.score(p, view.q)) return false;
    return true;
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
      .concat(names.map((n) => `<button data-sub="${esc(n)}" aria-pressed="${view.sub === n}">${esc(n)}</button>`)).join("");
  }

  function renderActive() {
    const chips = [];
    if (view.q) chips.push(["q", `“${view.q}”`]);
    if (view.size) chips.push(["size", `Size ${sizeLabel(view.size)}`]);
    if (view.band) chips.push(["band", view.band === "u2000" ? "Under ₹2,000" : BANDS.find((b) => b.id === view.band)?.label]);
    if (view.brand) chips.push(["brand", view.brand]);
    $("active").hidden = !chips.length;
    $("active").innerHTML = chips.map(([k, l]) => `<button type="button" data-clear="${k}">${esc(l)} <span aria-hidden="true">×</span></button>`).join("") + (chips.length ? `<button type="button" class="clear-all" data-clear="all">Clear all</button>` : "");
  }

  // Cards are kept between live updates and only rebuilt when that product changed, so
  // photos never reload or go blank on phones.
  const cardCache = new Map();
  function renderGrid(fresh = new Set()) {
    const list = view.q ? SR.find(products.filter(inView), view.q) : products.filter(inView).sort(sortRack);
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
    $("empty").textContent = view.q ? `Nothing matches “${view.q}” here right now. Try fewer words, or ask us on WhatsApp.` : "Nothing here right now. New stock lands most days.";
    moreLeft = list.length > view.shown;
    $("count").textContent = list.length ? `Showing ${shown.length} of ${list.length}` : "";
    renderSubs();
    renderActive();
    renderShopBy();
    document.querySelectorAll(".cat-tab").forEach((b) => b.classList.toggle("on", Boolean(b.dataset.jump === view.tab && !view.band || (b.dataset.band && view.band === b.dataset.band))));
    try { sessionStorage.setItem(SHOWN_KEY, String(view.shown)); } catch { /* private mode */ }
    requestAnimationFrame(loadMore); // a tall screen may need more than one page to fill it
  }

  // ---- endless catalogue: the next page arrives before the customer reaches the end ----
  // Only when the end of the list is on its way up from below. Coming back up from the sections
  // under the rack it stays put, or the page would shift under the customer's finger.
  function loadMore() {
    if (!moreLeft || Date.now() < holdLoad) return;
    const y = $("count").getBoundingClientRect().top;
    if (y <= 0 || y > innerHeight + 700) return;
    view.shown += PAGE;
    renderGrid();
  }
  let loadQueued = false;
  addEventListener("scroll", () => {
    if (loadQueued) return;
    loadQueued = true;
    requestAnimationFrame(() => { loadQueued = false; loadMore(); });
  }, { passive: true });

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
      renderHeroFeed();
      renderDrop();
      renderLooks();
      renderFeatured();
      if (first) { renderTicker(); document.documentElement.classList.add("vx-ready"); }
      if (first && !qScrolled) { qScrolled = true; $("rack").scrollIntoView(); }
      // Arrived from another page's logo: Featured only exists once the products have loaded.
      if (first && location.hash === "#feat" && !$("feat").hidden) $("feat").scrollIntoView();
      if (fresh.size) {
        const p = next.find((x) => fresh.has(x.id));
        toast(`<b>New drop</b><span>${esc(p.name)}${p.price ? ` · ${rupees(p.price)}` : ""}</span><button type="button" class="toast-go" data-goto="${esc(p.id)}">See it</button>`);
      }
    } catch { /* server restarting; next tick retries */ }
  }

  // ---- clicks ----
  document.addEventListener("click", (e) => {
    // "Visit the store" and friends fly past the rack: draw the real page first, and don't grow
    // the rack mid-flight, or they land in the wrong place
    if (e.target.closest('a[href^="#"]:not([data-jump]):not([data-dock])')) {
      document.documentElement.classList.add("vx-full");
      holdLoad = Date.now() + 1500;
    }
    const jump = e.target.closest("[data-jump]");
    if (jump) {
      e.preventDefault();
      const tab = jump.dataset.jump;
      setView({ tab, sub: jump.dataset.sub || null, size: null, band: null, brand: null, q: null }, true);
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
    if (clr) { const k = clr.dataset.clear; setView(k === "all" ? { size: null, band: null, brand: null, q: null } : { [k]: null }); return; }
    const goto = e.target.closest("[data-goto]");
    if (goto) {
      setView({ tab: "All", sub: null, size: null, band: null, brand: null, q: null });
      const el = document.querySelector(`.card[data-id="${CSS.escape(goto.dataset.goto)}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      $("toast").hidden = true;
      return;
    }
    if (e.target.closest('[data-dock="home"]')) { e.preventDefault(); scrollTo({ top: 0, behavior: "smooth" }); }
  });
  $("subs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-sub]");
    if (b) setView({ sub: b.dataset.sub || null });
  });

  window.VXOrder.install((id) => products.find((p) => p.id === id));

  // Search: "See all" in the box, or a link to /?q=puffer, shows every match in the rack.
  const searchRack = (q) => setView({ tab: "All", sub: null, size: null, band: null, brand: null, q }, true);
  SR.connect(() => products, searchRack);
  const askedFor = new URLSearchParams(location.search).get("q");
  if (askedFor && askedFor.trim()) { view.q = askedFor.trim().slice(0, 60); view.tab = "All"; }
  let qScrolled = !view.q;

  // ---- phone dock: hides while scrolling down, comes back on the way up ----
  let lastY = scrollY;
  addEventListener("scroll", () => {
    const y = scrollY;
    $("dock").classList.toggle("away", y > lastY && y > 200);
    lastY = y;
  }, { passive: true });

  // Recent sales mark sold cards in the grid. The "just bought" banner is salebar.js.
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
  refreshSales();
  setInterval(refreshSales, 15000);

  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  addEventListener("pageshow", (e) => { if (e.persisted) refresh(); });
  addEventListener("focus", refresh);

  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 5000); // new stock still appears in seconds, without a phone fetching the list non-stop
})();
