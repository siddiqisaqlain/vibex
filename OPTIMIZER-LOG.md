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

## 2026-11-11 (night 4)
- **Changed:** new `/llms.txt` (`llmsTxt()` in server.js): shop name, tagline, legal name, address, phone, map, Instagram/YouTube, dispatch/delivery days, courier per-kg rates, 7-day change-of-mind, 48h damage report, 5-day refund, page links. All values read from shop.json; nothing invented. Payment methods left out on purpose (not summarised in shop.json policy).
- **Why:** backlog item 4 (GEO).
- **Files:** server.js, OPTIMIZER-LOG.md.
- **Checks:** node --check server.js; local server: /llms.txt, /, /sitemap.xml all 200; tests/domain.mjs 22/22.
- **Note:** live site unreachable from the sandbox again (proxy refused), judged from repo.
- **Next:** FAQ block + FAQPage schema from policy; canonical/OG on /wardrobe and legal pages (inject in server.js, not lib/legal.js); meta description quality, image alt text, heading order.

## 2026-11-12 (night 5)
- **Changed:** visible "Questions" FAQ section on the home page (before "The store", matches the existing `#faq` nav link) plus FAQPage JSON-LD. Six Q&As built at serve time from shop.json policy (delivery time, courier rates, change-of-mind return, damage report + refund, payment by UPI/WhatsApp as already stated in "How it works", store address). `homeFaq()` in server.js; small `.faq` styles appended to public/shop.css.
- **Why:** backlog item 5 (AEO).
- **Checks:** node --check server.js; local /, /sitemap.xml, /llms.txt 200; Store + FAQPage JSON-LD parse; FAQ appears once, before #visit; tests/domain.mjs 22/22 (needed `npm ci` first).
- **Left out on purpose:** the "Why is it this cheap?" answer (claims.surplus in shop.json is marked DRAFT, not owner-confirmed).
- **Note:** live site unreachable from the sandbox again, judged from repo.
- **Next:** canonical/OG on /wardrobe and legal pages (inject in server.js, not lib/legal.js); meta description quality, image alt text, heading order on home; add the surplus FAQ once the owner confirms it.

## 2026-11-13 (night 6)
- **Changed:** canonical link + Open Graph/Twitter tags on /wardrobe (now served by `wardrobePage()`) and on /returns, /terms, /privacy, /contact (injected via new `canonicalHead()` in server.js; lib/legal.js untouched).
- **Why:** backlog item 3 remainder.
- **Files:** server.js, OPTIMIZER-LOG.md.
- **Checks:** node --check server.js; local 200 and exactly one canonical on /, /wardrobe and the four legal pages; tests/domain.mjs 22/22.
- **Note:** live site unreachable from the sandbox again (proxy 403), judged from repo.
- **Next:** meta description quality, image alt text, heading order on home; add surplus FAQ once owner confirms claims.surplus.

## 2026-11-14 (night 7)
- **Changed:** home meta description (index.html, plus the copy used for Open Graph and Store JSON-LD in `homeHead()`) now also says the store is in Khanyaar, Srinagar and that orders can be placed on WhatsApp. Both facts already exist in shop.json / the page.
- **Why:** backlog "meta description quality".
- **Checked, no change needed:** heading order on home (one h1, h2 sections, h3 panels) is fine; product images already carry the product name as alt text; decorative thumbnails correctly use empty alt.
- **Files:** server.js, public/index.html, OPTIMIZER-LOG.md.
- **Checks:** node --check server.js; local / 200, description present in meta/OG/JSON-LD, all JSON-LD parses; tests/domain.mjs 22/22.
- **Note:** live site unreachable from the sandbox again, judged from repo.
- **Next:** add the surplus FAQ once the owner confirms claims.surplus; consider a per-product meta description fallback when a product has no description (currently generic text). Otherwise the backlog is essentially done.

## 2026-11-15 (night 8)
- **Changed:** product pages with no written description now get a fuller fallback meta/OG description (name, brand, category, size, "Original surplus, in stock at Vibe X, Srinagar. Ships across India." or "Sold", using real stock), and Product JSON-LD now carries the same description instead of omitting it. Written descriptions are unchanged.
- **Why:** backlog "per-product meta description fallback".
- **Files:** server.js, OPTIMIZER-LOG.md.
- **Checks:** node --check server.js; local /p/s1 and / 200; both JSON-LD blocks parse; tests/domain.mjs 22/22.
- **Note:** live site unreachable from the sandbox again (proxy refused), judged from repo.
- **Next:** only the surplus FAQ remains (needs owner to confirm claims.surplus). Backlog otherwise done.

## 2026-11-16 (night 9)
- **Changed:** nothing in the site. Log only.
- **Why:** the backlog is done. Remaining ideas are blocked or risky: the surplus FAQ needs the owner to confirm `claims.surplus` (still marked DRAFT); AggregateRating/Review markup was deliberately not added (Google disallows self-serving reviews on the shop's own LocalBusiness markup, and the ratings are copied from third-party listings).
- **Note:** live site unreachable from the sandbox again (proxy 403), so nothing could be compared against live state.
- **Next:** owner to confirm claims.surplus, then add that FAQ; fill business.email / opening hours in shop.json if they want them in Store JSON-LD; add real store photos (storePhotos) for image SEO.

## 2026-11-17 (night 10)
- **Changed:** nothing in the site. Log only.
- **Why:** backlog still complete; the only open items need the owner (confirm `claims.surplus` for a surplus FAQ; fill business.email / opening hours; real store photos).
- **Note:** live site unreachable from the sandbox again (no connection), so nothing could be compared against live state.

## 2026-11-18 (night 11)
- **Changed:** nothing in the site. Log only.
- **Why:** backlog still complete; open items need the owner (confirm `claims.surplus` for a surplus FAQ; business.email / opening hours; real store photos).
- **Note:** live site unreachable from the sandbox again (proxy refused connection), so nothing could be compared against live state.

## 2026-11-19 (night 12)
- **Changed:** nothing in the site. Log only.
- **Why:** backlog still complete; open items need the owner (confirm `claims.surplus` for a surplus FAQ; business.email / opening hours; real store photos).
- **Note:** live site unreachable from the sandbox again (proxy refused connection), so nothing could be compared against live state.

## 2026-11-20 (night 13)
- **Changed:** nothing in the site. Log only.
- **Why:** backlog still complete; open items need the owner (confirm `claims.surplus` for a surplus FAQ; business.email / opening hours; real store photos).
- **Note:** live site unreachable from the sandbox again (no connection), so nothing could be compared against live state.

## 2026-11-21 (night 14)
- **Changed:** nothing in the site. Log only.
- **Why:** backlog still complete; open items need the owner (confirm `claims.surplus`, still marked DRAFT; business.email / opening hours; real store photos).
- **Note:** live site unreachable from the sandbox again (proxy 403), so nothing could be compared against live state.

## 2026-11-22 (night 15)
- **Changed:** nothing in the site. Log only.
- **Why:** backlog still complete; open items need the owner (confirm `claims.surplus`, still marked DRAFT; business.email / opening hours; real store photos).
- **Note:** live site unreachable from the sandbox again (no connection), so nothing could be compared against live state.

## 2026-11-23 (night 16)
- **Changed:** nothing in the site. Log only.
- **Why:** backlog still complete; open items need the owner (confirm `claims.surplus`, still marked DRAFT; business.email / opening hours; real store photos).
- **Note:** live site unreachable from the sandbox again (no connection), so nothing could be compared against live state.

## 2026-11-24 (night 17)
- **Changed:** nothing in the site. Log only.
- **Why:** backlog still complete; open items need the owner (confirm `claims.surplus`, still marked DRAFT; business.email / opening hours; real store photos).
- **Note:** live site unreachable from the sandbox again (no connection), so nothing could be compared against live state.

## 2026-11-25 (night 18)
- **Changed:** nothing in the site. Log only.
- **Why:** backlog still complete; open items need the owner (confirm `claims.surplus`, still marked DRAFT; business.email / opening hours; real store photos).
- **Note:** live site unreachable from the sandbox again (no connection), so nothing could be compared against live state.

## 2026-11-26 (night 19)
- **Changed:** nothing in the site. Log only.
- **Why:** backlog still complete; open items need the owner (confirm `claims.surplus`, still marked DRAFT; business.email / opening hours; real store photos).
- **Note:** live site unreachable from the sandbox again (no connection), so nothing could be compared against live state.

## 2026-11-27 (night 20)
- **Changed:** nothing in the site. Log only.
- **Why:** backlog still complete; open items need the owner (confirm `claims.surplus`, still marked DRAFT; business.email / opening hours; real store photos).
- **Note:** live site unreachable from the sandbox again (no connection), so nothing could be compared against live state.
