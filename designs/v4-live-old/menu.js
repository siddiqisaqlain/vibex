// Phone menu: full-screen list, links arrive one after another.
(() => {
  const btn = document.querySelector(".menu-btn");
  const menu = document.getElementById("menu");
  const ig = document.getElementById("ig-menu");
  if (ig) ig.href = window.SHOP.instagram;
  if (!btn || !menu) return;
  const close = () => {
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-label", "Open menu");
    document.body.classList.remove("menu-open");
    menu.classList.remove("open");
    setTimeout(() => { if (!menu.classList.contains("open")) menu.hidden = true; }, 300);
  };
  btn.addEventListener("click", () => {
    if (menu.classList.contains("open")) return close();
    // Start the panel right under the header (the ticker above it can scroll away).
    const top = document.querySelector(".top");
    menu.style.top = `${Math.max(0, top ? top.getBoundingClientRect().bottom : 58)}px`;
    menu.hidden = false;
    requestAnimationFrame(() => menu.classList.add("open"));
    btn.setAttribute("aria-expanded", "true");
    btn.setAttribute("aria-label", "Close menu");
    document.body.classList.add("menu-open");
  });
  menu.addEventListener("click", (e) => { if (e.target.closest("a")) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && menu.classList.contains("open")) close(); });
})();
