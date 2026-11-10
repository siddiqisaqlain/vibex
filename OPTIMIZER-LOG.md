# Optimizer log

Nightly SEO / GEO / AEO notes. Newest last. Hard rules: no checkout/payment/legal/owner code, no invented facts.

## 2026-11-10
- **Changed:** `/robots.txt` (allows the shop, blocks /api/, /billing, /analytics, /kit, /bag, /account, /bill/, /preview/; points to the sitemap) and `/sitemap.xml` generated from the live product list (home, /wardrobe, legal pages, every public /p/<id>). Uses `PUBLIC_URL`/Render domain, so links are https://vibexindia.com.
- **Why:** Google had no crawl guidance or product list. First backlog item.
- **Files:** server.js (siteOrigin, robotsTxt, sitemapXml + two routes), OPTIMIZER-LOG.md.
- **Checks:** node --check server.js; local server returned 200 for /, /robots.txt, /sitemap.xml; sitemap parses as XML; tests/domain.mjs 22/22. tests/search.mjs can't run in the sandbox (needs macOS Chrome path), fails identically without the change.
- **Note:** the live site could not be fetched this night (sandbox proxy returned 403), so live state was judged from the repo only.
- **No `lastmod`** in the sitemap: no real modified dates exist.
- **Backlog, in order:**
  1. Store/LocalBusiness JSON-LD on home (address + phone from shop.json; no email, hours or GSTIN exist, leave out).
  2. Product JSON-LD with Offer on /p/<id> (productMeta in server.js); add canonical link and `robots` check for sold items.
  3. Canonical + Open Graph on the home page and legal pages.
  4. /llms.txt from shop.json.
  5. FAQ block + FAQPage schema from shipping/returns/payment policy in shop.json.
  6. Meta description quality; image alt text; heading order on home.
