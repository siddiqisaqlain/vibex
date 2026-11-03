// Owner screen add-ons, shared by every design's /demo page:
//  1. Two narrow stats bars under the header (live from /api/stats).
//  2. Reply buttons under the bot's messages (like WhatsApp quick-reply buttons).
//  3. A celebration when a product goes live on the website.
// The demo page calls window.OwnerKit.onReply(data) after each bot reply.
window.OwnerKit = (() => {
  const KEY = new URLSearchParams(location.search).get("key") || "";
  const headers = KEY ? { "x-owner-key": KEY } : {};
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
  const short = (n) => (n >= 1e5 ? `₹${(n / 1e5).toFixed(n >= 1e6 ? 0 : 1)}L` : n >= 1e3 ? `₹${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : inr(n));
  const SECTION = { Clothing: "Clothes", Fragrances: "Perfume", Footwear: "Shoes", Accessories: "Accessories" };

  // ---------- 1. Stats bars ----------
  const TILES = [
    { k: "live", label: "Live on site", icon: "🛍️" },
    { k: "postedToday", label: "Posted today", icon: "📈" },
    { k: "soldToday", label: "Sold today", icon: "💸", sub: (s) => (s.salesToday ? inr(s.salesToday) : "") },
    { k: "ordersToCheck", label: "Orders to check", icon: "💰", alert: true },
    { k: "enquiriesToday", label: "Enquiries today", icon: "💬" },
    { k: "drafts", label: "Waiting for done", icon: "📝", alert: true },
  ];
  const bars = document.createElement("section");
  bars.className = "kit-bars";
  bars.setAttribute("aria-label", "Today's numbers");
  bars.innerHTML = `<div class="kit-bar kit-main">${TILES.map((t) => `
      <div class="kit-tile" data-k="${t.k}"><span class="kit-ico" aria-hidden="true">${t.icon}</span>
        <div><b class="kit-num">–</b><small>${t.label}<i class="kit-sub"></i></small></div></div>`).join("")}</div>
    <div class="kit-bar kit-strip" id="kit-strip"></div>`;
  const head = document.querySelector(".head");
  (head || document.body.firstElementChild).after(bars);
  document.body.classList.add("kit-on");
  const fit = () => document.documentElement.style.setProperty("--kit-h", `${bars.offsetHeight}px`);
  addEventListener("resize", fit);
  fit();

  let last = null;
  function bump(el, diff) {
    el.classList.remove("kit-bump"); void el.offsetWidth; el.classList.add("kit-bump");
    if (diff > 0 && !calm) {
      const plus = document.createElement("span");
      plus.className = "kit-plus";
      plus.textContent = `+${diff}`;
      el.appendChild(plus);
      setTimeout(() => plus.remove(), 1400);
    }
  }
  function render(s) {
    for (const t of TILES) {
      const el = bars.querySelector(`[data-k="${t.k}"]`);
      el.querySelector(".kit-num").textContent = s[t.k];
      el.querySelector(".kit-sub").textContent = t.sub && t.sub(s) ? ` · ${t.sub(s)}` : "";
      el.classList.toggle("kit-alert", Boolean(t.alert && s[t.k] > 0));
      if (last && s[t.k] !== last[t.k]) bump(el, s[t.k] - last[t.k]);
    }
    const sections = Object.entries(s.sections).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `<span>${esc(SECTION[k] || k)} <b>${v}</b></span>`).join("");
    document.getElementById("kit-strip").innerHTML = `
      <span>📦 In stock <b>${s.units}</b> pcs · worth <b>${short(s.stockValue)}</b></span>
      <span>⏳ Last piece <b>${s.lastOne}</b></span>
      <span>✔️ Sold out <b>${s.soldOut}</b></span>
      <span class="kit-streak${s.streak > 1 ? " on" : ""}">🔥 Streak <b>${s.streak}</b> day${s.streak === 1 ? "" : "s"}</span>
      <span class="kit-sep" aria-hidden="true"></span>${sections}`;
    last = s;
    fit();
  }
  async function refresh() {
    try {
      const res = await fetch("/api/stats", { cache: "no-store", headers });
      if (res.ok) render(await res.json());
    } catch { /* server restarting */ }
  }
  refresh();
  setInterval(refresh, 3000);

  // ---------- 2. Reply buttons ----------
  function buttons(list) {
    document.querySelectorAll(".kit-btns").forEach((b) => b.remove());
    if (!list || !list.length) return;
    const chat = document.getElementById("chat");
    const msg = [...chat.querySelectorAll(".msg.them")].pop();
    if (!msg) return;
    const row = document.createElement("div");
    row.className = "kit-btns";
    row.innerHTML = list.map((b) => `<button type="button">${esc(b)}</button>`).join("");
    msg.after(row);
    chat.scrollTop = chat.scrollHeight;
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".kit-btns button");
    if (!b) return;
    const text = document.getElementById("text");
    const form = document.getElementById("form");
    b.parentElement.remove();
    text.value = b.textContent;
    form.requestSubmit();
  });

  // ---------- 3. Celebration ----------
  function confetti() {
    if (calm) return;
    const c = document.createElement("canvas");
    c.className = "kit-confetti";
    c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio;
    document.body.appendChild(c);
    const g = c.getContext("2d");
    g.scale(devicePixelRatio, devicePixelRatio);
    const tag = getComputedStyle(document.documentElement).getPropertyValue("--tag").trim() || "#ff5a1f";
    const colors = [tag, "#00a884", "#ffd23f", "#f3efe4", "#53bdeb", "#ff4fa3"];
    const site = document.querySelector(".browser")?.getBoundingClientRect() || { left: innerWidth / 2, top: 80, width: 0 };
    const ox = site.left + site.width / 2, oy = site.top + 40;
    const bits = Array.from({ length: 160 }, () => {
      const a = Math.random() * Math.PI - Math.PI, v = 6 + Math.random() * 9;
      return { x: ox, y: oy, vx: Math.cos(a) * v * 1.3, vy: Math.sin(a) * v, r: 4 + Math.random() * 5, rot: Math.random() * 6, vr: (Math.random() - .5) * .4, col: colors[(Math.random() * colors.length) | 0], round: Math.random() < .3 };
    });
    const t0 = performance.now();
    (function frame(t) {
      const k = (t - t0) / 2600;
      g.clearRect(0, 0, innerWidth, innerHeight);
      for (const p of bits) {
        p.vy += .28; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        g.save(); g.globalAlpha = Math.max(0, 1 - k * k); g.translate(p.x, p.y); g.rotate(p.rot); g.fillStyle = p.col;
        if (p.round) { g.beginPath(); g.arc(0, 0, p.r / 2, 0, 7); g.fill(); } else g.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
        g.restore();
      }
      if (k < 1) requestAnimationFrame(frame); else c.remove();
    })(t0);
  }
  function banner(w) {
    const host = document.querySelector(".browser") || document.body;
    host.classList.add("kit-host");
    host.querySelector(".kit-win")?.remove();
    const el = document.createElement("div");
    el.className = "kit-win";
    el.setAttribute("role", "status");
    el.innerHTML = `${w.image ? `<img src="${esc(w.image)}" alt="">` : `<span class="kit-win-ico">🎉</span>`}
      <div><small>Live on your website</small><b>${esc(w.name)}</b>
      <span>Code ${esc(w.code)} · ${w.postedToday} posted today${w.streak > 1 ? ` · 🔥 ${w.streak}-day streak` : ""}</span>
      ${w.milestone ? `<em>${esc(w.milestone)}</em>` : ""}</div>`;
    host.appendChild(el);
    setTimeout(() => el.classList.add("out"), w.milestone ? 5200 : 4000);
    setTimeout(() => el.remove(), w.milestone ? 5800 : 4600);
  }
  function celebrate(w) {
    confetti();
    banner(w);
    const live = bars.querySelector('[data-k="live"]');
    if (live) bump(live, 0);
  }

  return {
    onReply(data) {
      buttons(data && data.buttons);
      if (data && data.celebrate) celebrate(data.celebrate);
      refresh();
    },
  };
})();
