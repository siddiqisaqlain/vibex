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

## 2026-11-10 (night 2)
- **Changed:** home page `/` is now served by `homePage()`: adds canonical link, Open Graph/Twitter tags and Store JSON-LD (name, legal name, phone, address, map link, Instagram/YouTube from shop.json). Email, hours, GSTIN left out (not in shop.json).
- **Why:** backlog items 1 and 3 (home part).
- **Files:** server.js, OPTIMIZER-LOG.md.
- **Checks:** node --check server.js; local / and /sitemap.xml 200; JSON-LD parses; tests/domain.mjs 22/22. Needed `npm ci` in the sandbox first.
- **Note:** live site still unreachable from the sandbox (proxy 403), judged from repo.
- **Next:** Product JSON-LD + canonical on /p/<id> (productMeta); canonical/OG on legal pages; /llms.txt; FAQ + FAQPage; meta/alt/headings.

## 2026-11-10 (night 3)
- **Changed:** `productMeta` now adds a canonical link, Product JSON-LD (name, description, image, brand, category, sku from LOT code, Offer with INR price and InStock/SoldOut availability, seller) and BreadcrumbList (Home > product) to every /p/<id> that exists. 404 pages get none.
- **Why:** backlog item 2.
- **Files:** server.js, OPTIMIZER-LOG.md.
- **Checks:** node --check server.js; local server with seed products: /p/s1 200, both JSON-LD blocks parse, canonical present, /p/nope 404, / 200; tests/domain.mjs 22/22.
- **Left out on purpose:** itemCondition, ratings, reviews, GTIN (no such facts). Breadcrumb has no category level because no category pages exist.
- **Note:** live site unreachable from the sandbox again (proxy refused), judged from repo.
- **Next:** canonical/OG on legal pages and /wardrobe; /llms.txt from shop.json; FAQ + FAQPage from shop.json policy; meta description quality, image alt text, heading order.
