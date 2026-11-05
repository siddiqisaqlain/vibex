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

  // Trust strip: only the numbers the owner confirmed (shop.json → claims.stats).
  const stats = (S.claims && S.claims.stats) || [];
  $("stats").innerHTML = stats.map((x, i) => `<div><span class="trust-no">${String(i + 1).padStart(2, "0")}</span><p><b>${esc(x.big)}</b><span>${esc(x.small)}</span></p></div>`).join("");
  $("stats").hidden = !stats.length;
  $("stats").style.setProperty("--n", Math.max(1, stats.length));

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

  // ---- the hello popup, once per visit: by their own clock, with their first name if they gave
  // it. The name stays in this browser (checkout saves it too: order.js). ----
  const NAME_KEY = "vx-name";
  const kept = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const keep = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } };
  // The last visit, read once per visit, so a reload doesn't wipe "3 new since your last visit".
  const lastVisit = (() => {
    try {
      let since = sessionStorage.getItem("vx-since");
      if (since === null) { since = kept("vx-last") || kept("vx-been") || ""; sessionStorage.setItem("vx-since", since); keep("vx-last", String(Date.now())); }
      return since;
    } catch { return ""; }
  })();

  const HELLO_MS = 7000;
  function greetNow() {
    const h = new Date().getHours();
    const part = h >= 5 && h < 12 ? "morning" : h >= 12 && h < 17 ? "afternoon" : "evening";
    const card = document.createElement("div");
    card.className = "vx-hi"; card.setAttribute("role", "status");

    let timer = null, hovering = false;
    const close = () => { clearTimeout(timer); removeEventListener("keydown", onKey); card.classList.remove("on"); setTimeout(() => card.remove(), 400); };
    const busy = () => hovering || card.querySelector("form");
    const wait = (ms = HELLO_MS) => { clearTimeout(timer); timer = setTimeout(() => (busy() ? wait(1500) : close()), ms); }; // never closes on someone reading or typing
    const onKey = (e) => { if (e.key === "Escape") close(); };
    addEventListener("keydown", onKey);
    card.onpointerenter = (e) => { if (e.pointerType === "mouse") hovering = true; };
    card.onpointerleave = () => { hovering = false; };

    const draw = (title, wave, text, short = false) => {
      card.classList.toggle("short", short); // phones: nothing worth a second line
      card.innerHTML = `<b></b><p></p><div class="vx-hi-acts"></div><button class="vx-hi-x" type="button" aria-label="Close">×</button>`;
      card.querySelector("b").textContent = title;
      if (wave) card.querySelector("b").insertAdjacentHTML("beforeend", ' <span class="vx-hi-wave" aria-hidden="true">👋</span>');
      card.querySelector("p").textContent = text;
      card.querySelector(".vx-hi-x").onclick = close;
      return card.querySelector(".vx-hi-acts");
    };
    const action = (acts, label, fn, quiet) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = label; if (quiet) b.className = "quiet"; b.onclick = fn;
      acts.append(b);
    };

    function hello() {
      const name = window.VXOrder.firstName(kept(NAME_KEY));
      const since = Number(lastVisit) || 0; // "1" from an older visit: been here, date unknown
      const fresh = since > 1 ? products.filter((p) => p.status === "available" && new Date(p.createdAt) > since).length : 0;
      const title = name ? (h >= 23 || h < 5 ? `Still up, ${name}?` : `Good ${part}, ${name}`) : `Good ${part}`;
      const text = fresh ? `${fresh} new ${fresh === 1 ? "piece" : "pieces"} since your last visit.`
        : name ? "Good to see you again." : lastVisit ? "Welcome back to Vibe X." : "Welcome to Vibe X, all the way from Srinagar.";
      const acts = draw(title, Boolean(name), text, !fresh);
      if (fresh) {
        acts.insertAdjacentHTML("beforeend", `<a href="#rack" data-jump="All">See what's new →</a>`);
        acts.lastElementChild.addEventListener("click", close);
      }
      if (name) action(acts, "Not you?", () => { keep(NAME_KEY, null); hello(); wait(); }, true);
      else action(acts, "What should we call you?", ask, Boolean(fresh));
    }

    function ask() {
      draw("What should we call you?", false, "Just a first name. It stays on this device.");
      const form = document.createElement("form");
      form.noValidate = true;
      form.innerHTML = `<input aria-label="Your first name" placeholder="First name" autocomplete="given-name" autocapitalize="words" enterkeyhint="done" maxlength="30"><button type="submit">Save</button>`;
      card.querySelector(".vx-hi-acts").before(form);
      const input = form.firstElementChild;
      form.onsubmit = (e) => {
        e.preventDefault();
        const name = window.VXOrder.firstName(input.value);
        if (!name) { input.setAttribute("aria-invalid", "true"); input.focus(); return; }
        keep(NAME_KEY, name);
        draw(`Nice to meet you, ${name}`, true, "We'll say hello properly next time.");
        clearTimeout(timer); timer = setTimeout(close, 3000); // said its piece: goes even with the mouse resting on it
      };
      input.focus();
    }

    hello();
    const head = document.querySelector(".top");
    if (head) card.style.setProperty("--hi-top", `${Math.max(0, head.getBoundingClientRect().bottom) + 8}px`);
    document.body.append(card);
    requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add("on")));
    wait();
  }
  // Called once the opening map has lifted. Stock may still be on its way, and the count needs it.
  window.VXGreet = (tries = 12) => { if (products.length || tries <= 0) greetNow(); else setTimeout(() => window.VXGreet(tries - 1), 250); };

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
      <article class="card${p.status === "sold" ? " sold" : ""}" data-id="${esc(p.id)}">
        <div class="media ${p.image ? "" : "art-bg"}">${pic(p, eager)}<a class="cover" href="${pdp(p)}" aria-label="${esc(p.name)}"></a>
          ${badges(p)}
          ${p.status === "sold" ? `<div class="sold-stamp"><span>Sold out</span></div>` : ""}
          ${p.status === "hold" ? `<div class="sold-stamp hold-stamp"><span>On hold</span></div>` : ""}
        </div>
        <div class="info">
          <span class="brand">${esc(p.brand || p.subcategory || p.category)}</span>
          <h3 class="name"><a href="${pdp(p)}">${esc(p.name)}</a></h3>
          <div class="price"><b>${p.price ? `${manyPrices(p) ? "From " : ""}${rupees(p.price)}` : "Price on request"}</b>${off && !manyPrices(p) ? `<s>${rupees(p.mrp)}</s><em>(${off}% off)</em>` : ""}</div>
          ${meta ? `<span class="meta">${meta}</span>` : ""}
          ${window.VXOrder.button(p)}
        </div>
      </article>`;
  }

  // ---- category pills under the header ----
  // Hero numbers: counted from the rack right now, so they are always true.
  function renderHeroStats() {
    const live = products.filter((p) => p.status === "available");
    const labels = new Set(live.map((p) => p.brand).filter(Boolean)).size;
    const fresh = products.filter(isNew).length;
    const rows = [[live.length, live.length === 1 ? "piece on the rail" : "pieces on the rail"], [fresh, "new in 48 hours"], [labels, labels === 1 ? "label in stock" : "labels in stock"]].filter(([n]) => n > 0);
    $("hero-stats").innerHTML = rows.map(([n, l]) => `<div><dt>${n}</dt><dd>${l}</dd></div>`).join("");
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
  }

  // ---- banner slider, built from real photos ----
  let slideTimer = null;
  function renderSlider() {
    const photos = (list) => list.filter((p) => p.image && p.status === "available");
    const byNew = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);
    // the newest pieces with photos, one per slide (a mix of categories when there is one)
    const all = photos(products).sort(byNew);
    const picks = [];
    for (const c of CATS) { const p = all.find((x) => x.category === c); if (p) picks.push(p); }
    for (const p of all) if (picks.length < 5 && !picks.includes(p)) picks.push(p);
    const slides = picks.sort(byNew).slice(0, 5);
    const el = $("slider");
    el.hidden = !slides.length;
    if (!slides.length) return;
    $("slides").innerHTML = slides.map((p, i) => `
      <a class="slide" href="${pdp(p)}" role="group" aria-roledescription="slide" aria-label="${esc(p.name)}, ${i + 1} of ${slides.length}">
        <div class="slide-pics"><img src="${esc(p.image)}" alt="${esc(p.name)}" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"></div>
        ${isNew(p) ? `<span class="slide-flag">${hoursOld(p) < 24 ? "New today" : "Just in"}</span>` : ""}
        ${hasOffer(p) ? `<span class="slide-off">${offBadge(p)}</span>` : ""}
      </a>`).join("");
    const caption = (i) => {
      const p = slides[i];
      $("slide-cap").href = pdp(p);
      $("slide-cap").innerHTML = `<span>${esc(p.brand || p.category)}</span><b>${esc(p.name)}</b><em>${p.price ? rupees(p.price) : "Price on request"}${wasPrice(p)}</em>`;
      $("slide-count").textContent = `${String(i + 1).padStart(2, "0")} / ${String(slides.length).padStart(2, "0")}`;
    };
    caption(0);
    $("slider-dots").innerHTML = slides.length > 1 ? slides.map((_, i) => `<button type="button" aria-label="Slide ${i + 1}" data-slide="${i}"${i ? "" : ' aria-current="true"'}></button>`).join("") : "";
    const track = $("slides");
    const go = (i) => track.scrollTo({ left: i * track.clientWidth, behavior: "smooth" });
    const cur = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    const mark = () => {
      const i = cur();
      $("slider-dots").querySelectorAll("button").forEach((b, j) => b.toggleAttribute("aria-current", j === i));
      track.querySelectorAll(".slide").forEach((s, j) => s.classList.toggle("on", j === i));
      caption(Math.min(i, slides.length - 1));
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

  // ---- Featured, beside the video: pieces ticked in the portal, then the priciest in stock.
  // Skips what the hero slider already shows, and repeats of a name (several Tender Ambers). ----
  const FEATURED = 6;
  let featKey = "", featTimer = null, featSeen = null;
  function renderFeatured() {
    const box = $("feat");
    if (!box || $("latest").hidden) return;
    const ok = products.filter((p) => p.image && p.status === "available");
    const inHero = new Set([...document.querySelectorAll("#slides .slide")].map((a) => a.getAttribute("href")));
    const chosen = ok.filter((p) => p.featured);
    const rest = ok.filter((p) => !p.featured).sort((a, b) => (b.price || 0) - (a.price || 0));
    const picks = [...chosen];
    for (const skipHero of [true, false]) for (const p of rest) {
      if (picks.length >= FEATURED) break;
      if (picks.includes(p) || (skipHero && inHero.has(pdp(p))) || picks.some((x) => x.name === p.name)) continue;
      picks.push(p);
    }
    const list = picks.slice(0, FEATURED);
    box.hidden = !list.length;
    const key = list.map((p) => `${p.id}:${p.price}`).join();
    if (key === featKey) return; // this runs on every stock change: don't throw the customer back to slide 1
    featKey = key;
    const track = $("feat-track"), count = $("feat-count");
    const many = list.length > 1;
    track.innerHTML = list.map((p, i) => `
      <a class="feat-slide" href="${pdp(p)}" aria-label="${esc(p.name)}, ${i + 1} of ${list.length}">
        <span class="feat-pic"><img src="${esc(p.image)}" alt="" loading="lazy" decoding="async">${hasOffer(p) ? `<span class="feat-off">${offBadge(p)}</span>` : ""}</span>
        <span class="feat-cap"><span>${esc(p.brand && p.brand !== p.name ? p.brand : p.category)}</span><b>${esc(p.name)}</b><em>${p.price ? `${manyPrices(p) ? "From " : ""}${rupees(p.price)}` : "Price on request"}${wasPrice(p)}</em></span>
      </a>`).join("");
    $("feat-prev").hidden = $("feat-next").hidden = !many;
    const step = () => track.firstElementChild?.getBoundingClientRect().width + parseFloat(getComputedStyle(track).columnGap || 0) || 1;
    const cur = () => Math.round(track.scrollLeft / step());
    const mark = () => { count.textContent = many ? `${String(Math.min(cur(), list.length - 1) + 1).padStart(2, "0")} / ${String(list.length).padStart(2, "0")}` : ""; };
    const go = (i) => track.scrollTo({ left: ((i + list.length) % list.length) * step(), behavior: "smooth" });
    track.onscroll = mark; mark();
    $("feat-prev").onclick = () => go(cur() - 1);
    $("feat-next").onclick = () => go(cur() + 1);
    // Moves on its own only where it's one piece at a time, on screen, and nobody is busy with it
    // or watching the video. Phones show the next piece peeking in, and swipe.
    clearInterval(featTimer);
    if (!many || matchMedia("(prefers-reduced-motion: reduce)").matches || !matchMedia("(min-width: 761px)").matches) return;
    if (!featSeen) { featSeen = { now: false }; new IntersectionObserver(([e]) => { featSeen.now = e.isIntersecting; }, { threshold: .5 }).observe(box); }
    // :focus-visible, not :focus-within: a clicked arrow keeps focus, which would stop it for good
    featTimer = setInterval(() => {
      if (featSeen.now && !videoPlaying && !box.matches(":hover") && !box.querySelector(":focus-visible") && !document.hidden) go(cur() + 1);
    }, 5500);
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
    // one clean row for up to six tiles, otherwise two even rows
    $("range").style.setProperty("--cols", tiles.length <= 6 ? tiles.length : Math.ceil(tiles.length / 2));
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
    moreLeft = list.length > view.shown;
    $("count").textContent = list.length ? `Showing ${shown.length} of ${list.length}` : "";
    renderSubs();
    renderActive();
    renderShopBy();
    document.querySelectorAll(".cat-tab").forEach((b) => b.classList.toggle("on", b.dataset.jump === view.tab && !view.band || (b.dataset.band && view.band === b.dataset.band)));
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
      renderHeroStats();
      renderRange();
      renderLooks();
      if (first || fresh.size) renderSlider();
      renderFeatured();
      if (first) renderTicker();
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
  $("subs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-sub]");
    if (b) setView({ sub: b.dataset.sub || null });
  });

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
    if (!t.hidden || shownThisVisit >= 3 || document.querySelector(".vx-hi")) return; // one note at a time
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
