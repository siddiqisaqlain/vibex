// Links that leave the shop open in a new tab, so the shop stays open behind them:
// other sites (WhatsApp, Instagram, Maps, ...) and the policy pages. Product pages and
// in-page links stay in the same tab. Also covers links drawn later by the page's scripts.
(() => {
  const POLICY = /^\/(returns|terms|privacy|contact)\/?$/;
  function mark(a) {
    const href = a.getAttribute("href");
    if (!href || href[0] === "#" || /^(mailto|tel|sms|javascript):/i.test(href)) return;
    let u;
    try { u = new URL(href, location.href); } catch { return; }
    if (u.origin !== location.origin || POLICY.test(u.pathname)) {
      a.target = "_blank";
      a.rel = "noopener";
    }
  }
  const scan = (root) => { if (root.matches && root.matches("a[href]")) mark(root); if (root.querySelectorAll) root.querySelectorAll("a[href]").forEach(mark); };
  scan(document);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "attributes") mark(m.target);
      else m.addedNodes.forEach((n) => n.nodeType === 1 && scan(n));
    }
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
})();
