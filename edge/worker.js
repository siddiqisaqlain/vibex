// Vibe X edge (see wrangler.toml). Everything goes to the shop untouched. Only when the shop can't answer
// (restarting after a push, or down) does a visitor opening a page get the page below instead of a bare 502.
// Nothing else is changed: scripts, photos, the API and the WhatsApp webhook get the shop's own answer, or a
// plain 503 if there is none, so the pages' own "try again" handling keeps working.
const DOWN = new Set([502, 503, 504, 520, 521, 522, 523, 524]);
const WHATSAPP = "917006656599"; // shop.json -> whatsapp

const PAGE = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Back in a moment · Vibe X</title>
<meta name="robots" content="noindex">
<meta name="theme-color" content="#f4f2ee">
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:24px;background:#f4f2ee;color:#121212;font:400 16px/1.5 "Helvetica Neue",Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
  main{width:min(420px,100%);text-align:center}
  .logo{font:800 34px/1 "Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:-.05em}
  .logo span{color:#e2382c}
  .rail{position:relative;height:3px;margin:28px auto 26px;width:150px;border-radius:2px;background:rgba(18,18,18,.14);overflow:hidden}
  .rail i{position:absolute;inset:0;background:#121212;border-radius:2px;transform:translateX(-100%);animation:run 1.6s cubic-bezier(.4,0,.2,1) infinite}
  @keyframes run{60%,100%{transform:translateX(100%)}}
  h1{margin:0;font:600 30px/1.05 "Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:-.04em}
  p{margin:12px auto 0;max-width:30ch;color:#3d3c39}
  .note{margin-top:22px;font:500 11.5px/1.4 ui-monospace,"SF Mono",Menlo,monospace;text-transform:uppercase;letter-spacing:.08em;color:#6d6b65}
  a{display:inline-flex;align-items:center;justify-content:center;height:48px;margin-top:22px;padding:0 24px;border:1px solid rgba(18,18,18,.22);border-radius:999px;color:#121212;text-decoration:none;font-weight:500;font-size:14px}
  @media (prefers-reduced-motion:reduce){.rail i{animation:none;transform:none;opacity:.35}}
</style></head><body>
<main>
  <div class="logo">VIBE<span>X</span></div>
  <div class="rail" aria-hidden="true"><i></i></div>
  <h1>Putting new pieces on the rack.</h1>
  <p>The shop is updating and will be back in under a minute. Your bag is safe.</p>
  <p class="note" id="note" role="status">This page reloads by itself</p>
  <a href="https://wa.me/${WHATSAPP}" target="_blank" rel="noopener">Message us on WhatsApp</a>
</main>
<script>
  // Ask quietly every few seconds; the moment the shop answers, load the page the visitor wanted.
  (function () {
    var tries = 0;
    function check() {
      tries++;
      fetch("/api/products", { cache: "no-store" }).then(function (r) {
        if (r.ok) location.reload(); else again();
      }).catch(again);
    }
    function again() {
      if (tries === 20) document.getElementById("note").textContent = "Taking longer than usual. Still trying";
      setTimeout(check, tries < 20 ? 3000 : 8000);
    }
    setTimeout(check, 3000);
  })();
</script>
</body></html>`;

export default {
  async fetch(request) {
    let res = null;
    try { res = await fetch(request); } catch { /* the shop didn't answer at all */ }
    if (res && !DOWN.has(res.status)) return res;
    const wantsPage = request.method === "GET" && (request.headers.get("accept") || "").includes("text/html");
    // The shop's own 503s (it sends a few, as JSON) and everything that isn't a page view pass through.
    if (!wantsPage || (res && (res.headers.get("content-type") || "").includes("json"))) {
      return res || new Response(JSON.stringify({ error: "The shop is restarting. Try again in a moment." }), { status: 503, headers: { "content-type": "application/json", "retry-after": "5", "cache-control": "no-store" } });
    }
    return new Response(PAGE, { status: 503, headers: { "content-type": "text/html; charset=utf-8", "retry-after": "10", "cache-control": "no-store" } });
  },
};
