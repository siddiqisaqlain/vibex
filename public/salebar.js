// "Aamir from Srinagar just bought…" banner. Real sales only, from /api/recent-sales.
(() => {
  const SEEN_KEY = "vx-sales-seen", SPOT_KEY = "vx-sales-spot", SHUT_KEY = "vx-sales-off", FRESH = 10 * 60e3, GAP = 20e3, STAY = 7000;
  const key = (s) => `${s.id}@${s.at}`;
  let seen = new Set();
  try { seen = new Set(JSON.parse(sessionStorage.getItem(SEEN_KEY) || "[]")); } catch { /* private mode */ }
  const remember = (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* fine */ } };
  const recall = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };
  let sales = [], bar = null, timer = 0, lastShown = 0;
  let spot = Number(recall(SPOT_KEY)) || 0; // the loop carries on from page to page
  let off = recall(SHUT_KEY) === "1";       // closed by hand: left alone for the rest of the visit

  const css = document.createElement("link");
  css.rel = "stylesheet"; css.href = "/salebar.css";
  document.head.append(css);

  const ago = (at) => {
    const m = Math.floor((Date.now() - new Date(at)) / 60e3);
    if (m < 1) return "Just now";
    if (m < 60) return `${m} minute${m > 1 ? "s" : ""} ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} hour${h > 1 ? "s" : ""} ago`;
    const d = Math.floor(h / 24);
    return d === 1 ? "Yesterday" : `${d} days ago`;
  };
  const hour = (s) => Date.now() - new Date(s.at) < 3600e3;
  const isFresh = (s) => Date.now() - new Date(s.at) < FRESH;
  const part = (tag, cls, text) => { const e = document.createElement(tag); e.className = cls; e.textContent = text; return e; };

  function close() { clearTimeout(timer); bar?.remove(); bar = null; }

  function open(s) {
    const link = document.createElement(s.onSite ? "a" : "div"); // items not on the website have no page
    link.className = "vx-sale-link";
    if (s.onSite) link.href = `${window.VX_BASE || ""}/p/${encodeURIComponent(s.id)}`;
    // The nudge comes from real stock only: no invented counts or timers.
    const gone = s.left === 0, scarce = s.left > 0;
    link.append(part("i", "vx-sale-dot", ""), part("b", "", s.who), ` ${hour(s) ? "just grabbed" : "bought"} ${s.name}${s.qty > 1 ? ` (×${s.qty})` : ""}`);
    const line = part("small", "", ago(s.at));
    if (gone || scarce) line.prepend(part("em", "", gone ? "Sold out" : `Only ${s.left} left`), " · ");
    if (s.onSite && !gone) line.append(part("strong", "", " Get yours →"));
    link.append(line);
    const x = part("button", "vx-sale-x", "×");
    x.type = "button"; x.setAttribute("aria-label", "Close");
    x.onclick = () => { off = true; remember(SHUT_KEY, "1"); close(); };
    bar = document.createElement("div");
    bar.className = "vx-sale"; bar.setAttribute("role", "status");
    bar.dataset.sale = key(s);
    bar.append(link, x);
    bar.style.top = `${Math.max(0, document.querySelector(".top")?.getBoundingClientRect().bottom || 0) + 10}px`; // just under the header
    document.body.append(bar);
    timer = setTimeout(close, STAY);
  }

  // The first-visit intro covers the whole page, and the welcome note uses the same corner.
  const busy = () => document.querySelector(".vxi, .vx-hi");
  new MutationObserver(() => {
    if (!bar || !busy()) return;
    seen.delete(bar.dataset.sale); // they didn't get to read it, so it can show afterwards
    close();
  }).observe(document.body, { childList: true });

  function next() {
    if (off || bar || !sales.length || document.hidden || busy() || document.getElementById("toast")?.hidden === false) return;
    // A brand-new sale goes first, once. Otherwise the recent sales play round in a loop.
    let s = sales.find((x) => isFresh(x) && !seen.has(key(x)));
    if (!s && Date.now() - lastShown < GAP) return;
    s ||= sales[spot % sales.length];
    if (s === sales[spot % sales.length]) { spot = (spot + 1) % sales.length; remember(SPOT_KEY, spot); } // never twice running
    seen.add(key(s));
    remember(SEEN_KEY, JSON.stringify([...seen]));
    lastShown = Date.now();
    open(s);
  }

  async function refresh() {
    try {
      const res = await fetch("/api/recent-sales", { cache: "no-store" });
      if (res.ok) sales = await res.json();
    } catch { /* server restarting */ }
    next();
  }
  setTimeout(() => { refresh(); setInterval(next, 1000); }, 6000);
  setInterval(refresh, 15000);
})();
