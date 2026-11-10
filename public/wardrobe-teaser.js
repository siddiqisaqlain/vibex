// Home page: the way into /wardrobe. The teaser section and the menu links stay hidden until the
// owner has picked at least one piece for the wardrobe (portal: Items > The Wardrobe), so nobody
// is sent to an empty cabinet. The little cabinet shows real pieces from it.
(() => {
  const sec = document.getElementById("wardrobe-teaser");
  if (!sec) return;
  fetch("/api/products").then((r) => r.json()).then((list) => {
    const picked = list.filter((p) => p.wardrobe && p.image && p.status !== "sold");
    if (!picked.length) return;
    // up to three, one of each kind first (a jacket, a fragrance, then the next most premium)
    const byPrice = [...picked].sort((a, b) => (b.price || 0) - (a.price || 0));
    const kinds = [...new Set(byPrice.map((p) => p.category))];
    const show = kinds.map((k) => byPrice.find((p) => p.category === k));
    for (const p of byPrice) if (show.length < 3 && !show.includes(p)) show.push(p);
    const box = document.getElementById("wdt-pieces");
    for (const p of show.slice(0, 3)) {
      const d = document.createElement("div"); d.className = "wdt-piece";
      const im = document.createElement("img"); im.src = p.image; im.alt = ""; im.loading = "lazy";
      d.appendChild(im); box.appendChild(d);
    }
    document.getElementById("wdt-count").textContent = `${picked.length} piece${picked.length === 1 ? "" : "s"} inside`;
    sec.hidden = false;
    document.querySelectorAll(".wd-link").forEach((a) => (a.hidden = false));
    // the doors swing open the first time it comes into view
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setTimeout(() => sec.classList.add("open"), 250); io.disconnect(); } }, { threshold: 0.45 });
    io.observe(sec);
    sec.querySelector(".wdt-card").addEventListener("click", () => window.VXTrack?.("wardrobe_teaser"));
  }).catch(() => { /* no teaser, the page works as before */ });
})();
