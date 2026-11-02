// Shared page behaviour: phone menu, scroll reveals, external links.
(() => {
  const S = window.SHOP;
  const set = (id, url) => { const el = document.getElementById(id); if (el) el.href = url; };
  set("ig-top", S.instagram); set("ig-menu", S.instagram); set("ig-visit", S.instagram);
  set("map-hero", S.maps); set("map-visit", S.maps);

  // Phone menu: full height panel, links arrive one after another.
  const btn = document.querySelector(".menu-btn");
  const menu = document.getElementById("menu");
  if (btn && menu) {
    const close = () => {
      btn.setAttribute("aria-expanded", "false");
      btn.setAttribute("aria-label", "Open menu");
      document.body.classList.remove("menu-open");
      menu.classList.remove("open");
      setTimeout(() => { if (!menu.classList.contains("open")) menu.hidden = true; }, 300);
    };
    btn.addEventListener("click", () => {
      if (menu.classList.contains("open")) return close();
      menu.hidden = false;
      requestAnimationFrame(() => menu.classList.add("open"));
      btn.setAttribute("aria-expanded", "true");
      btn.setAttribute("aria-label", "Close menu");
      document.body.classList.add("menu-open");
    });
    menu.addEventListener("click", (e) => { if (e.target.closest("a")) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && menu.classList.contains("open")) close(); });
  }

  // Sections rise in once as they enter the viewport.
  const io = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      }, { rootMargin: "0px 0px -10% 0px" })
    : null;
  window.VXReveal = (root = document) => {
    root.querySelectorAll(".reveal:not(.in)").forEach((el) => (io ? io.observe(el) : el.classList.add("in")));
  };
  window.VXReveal();
})();
