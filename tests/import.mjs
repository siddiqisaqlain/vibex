// myBillBook stock import, plus bill discounts, charges and barcode data. `node tests/import.mjs`
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { shopperCookie } from "./_shopper.mjs";

const PORT = 4794;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibex-import-"));
fs.writeFileSync(path.join(dir, "products.json"), JSON.stringify([
  { id: "live1", code: "1111", name: "Zara Man", category: "Fragrances", price: 900, image: "/uploads/x.jpg", quantity: 9, status: "available", createdAt: new Date().toISOString() },
]));
const CSV = `Company Name: Vibe X
Phone No: 7006656599


Stock Summary Report
Dated: 05/11/2026 - 05/11/2026
Total Stock Value: 1
Total Stock Quantity: 1


Name,Batch No.,Item Code,Purchase Price,Selling Price,Stock Quantity,Stock Value,Item Category Name,MRP
"Puffer, new ",,934911410459,1770.0,2700.0,13.0 PCS,35100.0,"",37000.0
157 jeans,,956785429164,600.0,850.0,-2.0 PCS,-1700.0,jeans,4100.0
296707058704,,,,,-1.0 PCS,0.0,"",
Lee jeans,,111111111111,500.0,900.0,1.0 PCS,900.0,"",2000.0
Lee jeans,,222222222222,500.0,900.0,2.0 PCS,1800.0,"",2000.0
Armani blue dial,,,4800.0,8500.0,0.0 PCS,0.0,"",40000.0
zara man,,377111156845,450.0,750.0,1.0 PCS,750.0,"",2345.0
Dior 100 ml,,333333333333,1000.0,2000.0,0.0 PCS,0.0,"",3000.0
`;
const srv = spawn(process.execPath, ["server.js"], { cwd: path.resolve(import.meta.dirname, ".."),
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, ORDER_HOURS: "0-24", OWNER_KEY: "k", WA_TOKEN: "", WA_LOGIN_DEV: "1", ANTHROPIC_API_KEY: "", PUBLIC_URL: "" }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/products"); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
const H = { "x-owner-key": "k" };
H.cookie = await shopperCookie(base); // website orders need a signed-in customer
const imp = async (q = "", body = CSV) => { const r = await fetch(`${base}/api/billing/import${q}`, { method: "POST", headers: H, body }); return { status: r.status, ...(await r.json()) }; };
const all = () => fetch(base + "/api/billing/products", { headers: H }).then((r) => r.json());
const post = async (p, b) => { const r = await fetch(base + p, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify(b) }); return { status: r.status, ...(await r.json()) }; };
let pass = 0; const ok = (n) => { pass++; console.log("  ✓", n); };

try {
  assert.equal((await fetch(`${base}/api/billing/import`, { method: "POST", body: CSV })).status, 401); ok("import needs the owner key");
  assert.equal((await imp("", "not,a,stock,file")).status, 400); ok("a wrong file is refused");
  let r = await imp();
  assert.equal(r.preview, true); assert.equal((await all()).length, 1);
  assert.equal(r.report.rows, 8); assert.equal(r.report.added, 7); assert.equal(r.report.matched, 1);
  assert.equal(r.report.needCount.length, 2); assert.equal(r.report.noBarcode.length, 2); assert.equal(r.report.badName.length, 1);
  assert.equal(r.report.noPrice.length, 1); assert.deepEqual(r.report.sameName, ["Lee jeans (2 items)"]); assert.equal(r.report.highMrp.length, 1); ok("preview changes nothing and lists every problem");

  r = await imp("?apply=1"); assert.equal(r.preview, false);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith("products-before-import-")));
  let items = await all(); assert.equal(items.length, 8);
  const by = (n) => items.find((p) => p.name === n);
  assert.equal(by("Puffer, new").quantity, 13); assert.equal(by("Puffer, new").barcode, "934911410459"); assert.equal(by("Puffer, new").cost, 1770); assert.match(by("Puffer, new").code, /^\d{4}$/);
  assert.equal(by("157 jeans").quantity, 0); assert.equal(by("157 jeans").needsCount, true); assert.equal(by("157 jeans").status, "sold");
  assert.equal(by("Armani blue dial").category, "Accessories"); assert.equal(by("Dior 100 ml").category, "Fragrances"); ok("items import with stock, cost, barcode; negatives become 0 and flagged");
  const live = items.find((p) => p.id === "live1");
  assert.equal(live.price, 900); assert.equal(live.image, "/uploads/x.jpg"); assert.equal(live.quantity, 1); assert.equal(live.barcode, "377111156845"); assert.equal(live.hidden, undefined); ok("an item already on the website keeps its photo and price");

  const pub = await (await fetch(base + "/api/products")).json();
  assert.equal(pub.length, 1); assert.equal(pub[0].barcode, undefined); assert.equal(pub[0].cost, undefined); ok("imported items stay off the website; barcode and cost stay private");

  // Sell a hidden item, then re-import: nothing doubles, sales aren't undone
  const puffer = by("Puffer, new").id;
  r = await post("/api/billing/invoices", { lines: [{ productId: puffer, qty: 2, price: 2700, disc: 100 }], charges: [{ label: "Flying Machine", amount: 750 }], payment: "cash", customer: { name: "Bilal" } });
  assert.equal(r.status, 200); assert.equal(r.invoice.number, "7651"); assert.equal(r.invoice.total, 6050); assert.equal(r.invoice.lines[0].amount, 5300); ok("hidden items sell at the counter; line discount and extra charge add up");
  const page = await (await fetch(base + r.url)).text();
  for (const t of ["BILL OF SUPPLY", "ORIGINAL FOR RECIPIENT", "Invoice No.:", "Flying Machine", "Received Amount", "Returns and refunds within 7 days", "Six Thousand Fifty Rupees Only"]) assert.ok(page.includes(t), t); ok("the bill matches his layout");
  assert.equal((await post("/api/billing/invoices", { lines: [{ productId: puffer, qty: 1, price: 100, disc: 101 }] })).status, 409);
  assert.equal((await post("/api/billing/invoices", { lines: [{ productId: puffer, qty: 1 }], charges: [{ label: "", amount: 5 }] })).status, 409);
  assert.equal((await all()).find((p) => p.id === puffer).quantity, 11); ok("bad discounts and charges are refused, no stock taken");

  r = await imp("?apply=1");
  assert.equal(r.report.added, 0); items = await all(); assert.equal(items.length, 8); assert.equal(items.find((p) => p.id === puffer).quantity, 11); ok("re-importing adds nothing and doesn't undo sales");
  await imp("?apply=1&refreshStock=1"); assert.equal((await all()).find((p) => p.id === puffer).quantity, 13); ok("stock refresh only happens when asked for");

  await post("/api/billing/stock", { productId: by("157 jeans").id, quantity: 4 });
  const j = (await all()).find((p) => p.name === "157 jeans"); assert.equal(j.needsCount, undefined); assert.equal(j.status, "available"); ok("entering a count clears the flag and puts it on sale at the counter");

  // Short sale at the counter: billed, stock stays 0, flagged; cancel adds back only what existed
  const shortId = by("Dior 100 ml").id;
  assert.equal((await post("/api/billing/invoices", { lines: [{ productId: shortId, qty: 1 }] })).status, 409);
  r = await post("/api/billing/invoices", { lines: [{ productId: shortId, qty: 2 }], allowShort: true });
  assert.equal(r.status, 200); assert.equal(r.invoice.lines[0].short, 2);
  let d = (await all()).find((p) => p.id === shortId); assert.equal(d.quantity, 0); assert.equal(d.needsCount, true);
  await post(`/api/billing/invoices/${r.invoice.id}/cancel`, {});
  assert.equal((await all()).find((p) => p.id === shortId).quantity, 0);
  await post("/api/billing/stock", { productId: shortId, quantity: 1 });
  r = await post("/api/billing/invoices", { lines: [{ productId: shortId, qty: 3 }], allowShort: true });
  assert.equal(r.invoice.lines[0].short, 2); assert.equal((await all()).find((p) => p.id === shortId).quantity, 0);
  await post(`/api/billing/invoices/${r.invoice.id}/cancel`, {});
  assert.equal((await all()).find((p) => p.id === shortId).quantity, 1); ok("counter short sale bills, stops at 0, flags a count; cancel only restores real stock");

  // Website order for the same item stays strict
  const res = await post("/api/orders", { productId: "live1", name: "A", phone: "9000000009", delivery: "pickup" }); assert.equal(res.status, 200);
  await post(`/api/orders/${res.id}/cancel`, {}); // an open order holds the piece, and a held piece can't be recounted
  assert.equal((await post("/api/billing/stock", { productId: "live1", quantity: 0 })).status, 200);
  assert.equal((await post("/api/orders", { productId: "live1", name: "B", phone: "9000000010", delivery: "pickup" })).status, 409); ok("website can't order an item at 0");

  // Photo with a code puts a hidden item on the website
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const hidden = (await all()).find((p) => p.name === "Puffer, new");
  let m = await post("/api/message", { text: hidden.barcode, image: PNG });
  assert.match(m.reply, /is on your website/);
  let pub2 = await (await fetch(base + "/api/products")).json();
  const shown = pub2.find((p) => p.id === hidden.id); assert.ok(shown); assert.match(shown.image, /^\/uploads\//); assert.equal(shown.cost, undefined); assert.equal(shown.barcode, undefined);
  const badItem = (await all()).find((p) => p.name === "296707058704");
  m = await post("/api/message", { text: badItem.code, image: PNG }); assert.match(m.reply, /no selling price/);
  assert.ok(!(await (await fetch(base + "/api/products")).json()).some((p) => p.id === badItem.id)); ok("a photo with a code or barcode puts the item on the website; bad items stay off");

  m = await post("/api/message", { text: "Zara shirt 1499 M L", image: PNG }); assert.doesNotMatch(m.reply || "", /is on your website/); ok("normal photo posts still go the usual way");

  // Linking a website item to its imported stock record
  const stockRec = (await post("/api/billing/items", { name: "Lattafa stock", category: "Fragrances", price: 2500, cost: 1500, mrp: 4000, barcode: "555566667777", quantity: 6 })).product;
  await post("/api/billing/stock", { productId: "live1", quantity: 2 });
  const webBefore = (await all()).find((p) => p.id === "live1");
  const sale = await post("/api/billing/invoices", { lines: [{ productId: stockRec.id, qty: 1 }], payment: "cash" });
  assert.equal((await post("/api/billing/link", { websiteId: "live1", stockId: "nope" })).status, 409);
  assert.equal((await post("/api/billing/link", { websiteId: stockRec.id, stockId: stockRec.id })).status, 409);
  ok("linking refuses the wrong items");
  assert.equal((await fetch(`${base}/api/billing/link`, { method: "POST", body: "{}" })).status, 401);
  let linked = await post("/api/billing/link", { websiteId: "live1", stockId: stockRec.id }).catch((e) => e);
  assert.equal(linked.status, 409); assert.match(linked.error, /already linked/); ok("an already-linked website item can't be linked twice");
  const web2 = (await post("/api/billing/items", { name: "Web Only", price: 900, quantity: 1 })).product;
  await post("/api/message", { text: web2.code, image: PNG });
  assert.equal((await all()).find((p) => p.id === web2.id).hidden, undefined);
  linked = await post("/api/billing/link", { websiteId: web2.id, stockId: stockRec.id });
  assert.equal(linked.status, 200);
  const after = await all(); const one = after.find((p) => p.id === web2.id);
  assert.ok(!after.some((p) => p.id === stockRec.id)); assert.equal(one.barcode, "555566667777"); assert.equal(one.cost, 1500); assert.equal(one.quantity, 5); assert.equal(one.price, 900); assert.match(one.image, /^\/uploads\//); assert.equal(one.hidden, undefined); ok("linking leaves one item: website photo and price, real stock, barcode and cost");
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith("products-before-link-"))); ok("a copy is kept before linking");
  const bills2 = JSON.parse(fs.readFileSync(path.join(dir, "invoices.json")));
  assert.equal(bills2.find((x) => x.id === sale.invoice.id).lines[0].productId, web2.id); ok("earlier bills move to the linked item");
  r = await post("/api/billing/invoices", { lines: [{ productId: web2.id, qty: 2 }], payment: "cash" });
  assert.equal((await all()).find((p) => p.id === web2.id).quantity, 3);
  const pubOne = (await (await fetch(base + "/api/products")).json()).find((p) => p.id === web2.id); assert.equal(pubOne.quantity, 3); assert.equal(pubOne.barcode, undefined); ok("a counter sale now reduces the website item");
  const ret = await post("/api/billing/returns", { kind: "sale_return", invoiceId: sale.invoice.id, lines: [{ productId: web2.id, qty: 1 }], refund: 2500, mode: "cash" });
  assert.equal(ret.status, 200); assert.equal((await all()).find((p) => p.id === web2.id).quantity, 4); ok("a return on an earlier bill restocks the linked item");

  // Website is a subset of the inventory: taking an item off it never deletes anything
  const onSite = (await all()).find((p) => p.id === web2.id);
  await post("/api/message", { text: "clear" }); // the test photo from above is still waiting
  // Commands still work while a batch of photos waits, whether or not the photos are finished
  const IMG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  for (const [label, photos] of [
    ["finished", [{ image: IMG, text: "Dior perfume 999" }, { image: IMG, text: "Dior perfume 1999" }]],
    ["unfinished", [{ image: IMG, text: "Dior perfume" }, { image: IMG, text: "Dior perfume" }]],
    ["no caption", [{ image: IMG }, { image: IMG }]],
  ]) {
    await post("/api/message", { photos });
    const held = await post("/api/message", { text: "remove Web Only" });
    assert.equal(held.status, 200, `${label}: ${JSON.stringify(held)}`);
    assert.match(held.reply, /off the website/, label);
    await post(`/api/billing/items/${web2.id}`, { onWebsite: true });
    await post("/api/message", { text: "clear" });
  }
  ok("'remove' works while a batch of photos is waiting");

  let m2 = await post("/api/message", { text: "remove Web Only" });
  assert.match(m2.reply, /off the website/);
  let keep = (await all()).find((p) => p.id === web2.id);
  assert.ok(keep); assert.equal(keep.hidden, true); assert.equal(keep.quantity, onSite.quantity);
  assert.ok(!(await (await fetch(base + "/api/products")).json()).some((p) => p.id === web2.id)); ok("'remove' takes an item off the website and keeps it in stock");
  r = await post("/api/billing/invoices", { lines: [{ productId: web2.id, qty: 1 }], payment: "cash" });
  assert.equal(r.status, 200); ok("an item off the website still bills at the counter");
  const noPhoto = (await post("/api/billing/items", { name: "No Photo Yet", price: 100 })).product;
  assert.equal((await post(`/api/billing/items/${noPhoto.id}`, { onWebsite: true })).status, 409);
  r = await post(`/api/billing/items/${web2.id}`, { onWebsite: true }); assert.equal(r.status, 200);
  // Featured tick: reaches the customer page, and comes off again.
  const isFeatured = async () => (await (await fetch(`${base}/api/products`)).json()).find((x) => x.id === web2.id)?.featured;
  await post(`/api/billing/items/${web2.id}`, { featured: true }); assert.equal(await isFeatured(), true);
  await post(`/api/billing/items/${web2.id}`, { price: 901 }); assert.equal(await isFeatured(), true, "a later edit keeps the tick");
  await post(`/api/billing/items/${web2.id}`, { featured: false }); assert.equal(await isFeatured(), undefined);
  const back = (await (await fetch(base + "/api/products")).json()).find((p) => p.id === web2.id);
  assert.ok(back); assert.equal(back.quantity, 3); ok("'Show on website' brings it back with the right stock, and needs a photo");
  r = await post("/api/billing/invoices", { lines: [{ productId: web2.id, qty: 3 }], payment: "cash" });
  const gone = (await (await fetch(base + "/api/products")).json()).find((p) => p.id === web2.id);
  assert.equal(gone.status, "sold"); assert.equal(gone.quantity, 0); ok("selling the last pieces at the counter shows sold out on the website");

  // Sizes set from the portal
  const ml = (await post("/api/billing/items", { name: "Test Perfume", price: 999, quantity: 3, sizes: "50ml 2999 100ml 4999" })).product;
  assert.equal(ml.sizes, "50 ml · 100 ml"); assert.equal(ml.price, 2999); assert.deepEqual(ml.sizePrices, { "50 ml": 2999, "100 ml": 4999 });
  ok("the portal takes a price per ml size, like the WhatsApp command");
  let same = (await post(`/api/billing/items/${ml.id}`, { name: "Test Perfume", price: 2999, sizes: "50 ml 2999 · 100 ml 4999" })).product;
  assert.deepEqual(same.sizePrices, { "50 ml": 2999, "100 ml": 4999 }); assert.equal(same.price, 2999);
  ok("saving the form unchanged keeps the sizes and their prices");
  same = (await post(`/api/billing/items/${ml.id}`, { price: 3500 })).product;
  assert.equal(same.sizePrices, undefined); assert.equal(same.price, 3500);
  same = (await post(`/api/billing/items/${ml.id}`, { sizes: "100ml" })).product;
  assert.equal(same.sizes, "100 ml"); assert.equal(same.sizePrices, undefined); assert.equal(same.price, 3500);
  same = (await post(`/api/billing/items/${ml.id}`, { sizes: "" })).product;
  assert.equal(same.sizes, "");
  ok("one size keeps the selling price, and sizes can be cleared");
  same = (await post(`/api/billing/items/${ml.id}`, { sizes: "50ml 2999 100ml 4999" })).product;
  const bill = await post("/api/billing/invoices", { lines: [{ productId: ml.id, qty: 1, price: 4999, size: "100 ml" }], payment: "cash" });
  assert.equal(bill.status, 200); assert.equal(bill.invoice.lines[0].sizes, "100 ml"); assert.equal(bill.invoice.total, 4999);
  ok("a counter bill shows the size picked and its price");

  console.log(`\nAll ${pass} import checks passed.`);
} catch (e) { console.error("\nFAILED:", e); console.error(log.slice(-1500)); process.exitCode = 1; }
finally { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
