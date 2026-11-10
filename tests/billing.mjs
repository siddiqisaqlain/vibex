// Billing sync: a sale from the portal, WhatsApp or a website order changes the one stock
// file everyone reads, and writes one bill. Runs the real server. `node tests/billing.mjs`
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const PORT = 4792;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibex-billing-"));
const srv = spawn(process.execPath, ["server.js"], {
  cwd: path.resolve(import.meta.dirname, ".."),
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, ORDER_HOURS: "0-24", OWNER_KEY: "k", WA_TOKEN: "", ANTHROPIC_API_KEY: "", PUBLIC_URL: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/products"); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }

const H = { "Content-Type": "application/json", "x-owner-key": "k" };
const get = (p) => fetch(base + p, { headers: H }).then((r) => r.json());
const post = async (p, b) => { const r = await fetch(base + p, { method: "POST", headers: H, body: JSON.stringify(b) }); return { status: r.status, ...(await r.json()) }; };
const wa = async (text) => (await post("/api/message", { text })).reply;
const product = async (id) => (await get("/api/products")).find((p) => p.id === id);
let pass = 0; const ok = (name) => { pass++; console.log("  ✓", name); };

try {
  // Live shop starts empty: add two products the way the bot does (photo-less caption posts).
  fs.writeFileSync(path.join(dir, "products.json"), JSON.stringify([
    { id: "a1", code: "4795", name: "North Face Puffer", category: "Clothing", price: 6499, quantity: 3, status: "available", createdAt: new Date().toISOString() },
    { id: "b2", code: "5100", name: "Lattafa Khamrah", category: "Fragrances", price: 2799, quantity: 1, status: "available", createdAt: new Date().toISOString() },
  ]));

  assert.equal((await fetch(base + "/api/billing/invoices")).status, 401); ok("billing API needs the owner key");

  // 1. Portal sells 2 -> website/WhatsApp see 1 left
  let r = await post("/api/billing/invoices", { lines: [{ productId: "a1", qty: 2 }], customer: { name: "Aamir", phone: "9876543210" }, payment: "upi" });
  assert.equal(r.status, 200); assert.equal(r.invoice.number, "7651"); assert.equal(r.invoice.total, 12998);
  assert.equal((await product("a1")).quantity, 1); ok("portal sale takes stock off the website");

  // 2. WhatsApp "sold 4795" -> sold out everywhere, and it's a bill too
  let reply = await wa("sold 4795");
  assert.match(reply, /SOLD OUT/); assert.match(reply, /Bill 7652/);
  let p = await product("a1"); assert.equal(p.quantity, 0); assert.equal(p.status, "sold"); ok("WhatsApp sale = bill + sold out on site");

  // 3. Portal can't sell what WhatsApp just sold
  r = await post("/api/billing/invoices", { lines: [{ productId: "a1", qty: 1 }] });
  assert.equal(r.status, 409); assert.match(r.error, /sold out/); ok("portal refuses an item sold on WhatsApp");

  // 4. Cancel the portal bill -> 2 back on the website, WhatsApp sees them
  let list = (await get("/api/billing/invoices")).invoices;
  const first = list.find((x) => x.number === "7651");
  r = await post(`/api/billing/invoices/${first.id}/cancel`, {});
  assert.equal(r.status, 200); p = await product("a1"); assert.equal(p.quantity, 2); assert.equal(p.status, "available");
  reply = await wa("sold 4795 5");
  assert.match(reply, /you had only 2/); ok("cancelled bill restocks; WhatsApp sees restored stock");

  // 5. WhatsApp restock -> portal can sell again
  reply = await wa("add 4795 2");
  assert.equal((await product("a1")).quantity, 2);
  r = await post("/api/billing/invoices", { lines: [{ productId: "a1", qty: 1, price: 6000 }], payment: "cash" });
  assert.equal(r.status, 200); assert.equal(r.invoice.total, 6000); ok("WhatsApp restock -> portal sells (with discount)");

  // 6. Website order: paid -> held, portal can't sell it; WhatsApp confirm -> website bill
  let o = await post("/api/orders", { productId: "b2", name: "Sana", phone: "9123456789", delivery: "pickup" });
  assert.equal(o.status, 200);
  assert.equal((await product("b2")).status, "hold");
  r = await post("/api/billing/invoices", { lines: [{ productId: "b2", qty: 1 }] });
  assert.equal(r.status, 409); assert.match(r.error, /held for website order/); ok("item paid for online is held from the counter");
  reply = await wa(`confirm ${o.code}`);
  assert.match(reply, /confirmed/); assert.match(reply, /Bill \d{4}/);
  assert.equal((await product("b2")).status, "sold");
  list = (await get("/api/billing/invoices")).invoices;
  const web = list.find((x) => x.order === o.code);
  assert.equal(web.source, "website"); assert.equal(web.customer.name, "Sana"); ok("confirmed website order becomes a bill");

  // 7. Cancel that bill in the portal -> order cancelled, item back on sale
  r = await post(`/api/billing/invoices/${web.id}/cancel`, {});
  assert.equal((await product("b2")).status, "available");
  reply = await wa(`confirm ${o.code}`); assert.match(reply, /cancelled/); ok("portal cancel cancels the website order too");

  // 7b. WhatsApp cancel of a confirmed order cancels its bill
  o = await post("/api/orders", { productId: "b2", name: "Ali", phone: "9000000001", delivery: "pickup" });
  await wa(`confirm ${o.code}`);
  assert.equal((await product("b2")).status, "sold");
  await wa(`cancel ${o.code}`);
  assert.equal((await product("b2")).status, "available");
  list = (await get("/api/billing/invoices")).invoices;
  assert.equal(list.find((x) => x.order === o.code).status, "cancelled"); ok("WhatsApp cancel of a confirmed order cancels the bill");

  // 7c. Courier: the server sets it, the bill keeps it apart from the selling price, and no code takes anything off
  const ship = { productId: "b2", name: "Zoya", phone: "9000000003", delivery: "ship", address: "1 Road", city: "Delhi" };
  o = await post("/api/orders", { ...ship, pin: "110001", shipping: 1, amount: 1, promo: "FIRST10" });
  assert.equal(o.shipping, 130); assert.equal(o.amount, 2799 + 130); ok("courier outside Kashmir is added by the server, whatever the browser sends");
  reply = await wa(`confirm ${o.code}`);
  assert.match(reply, /photo of this exact piece/); ok("confirming a delivery reminds the owner to send the photo");
  const bill = (await get("/api/billing/invoices")).invoices.find((x) => x.order === o.code);
  assert.equal(bill.lines[0].amount, 2799); assert.equal(bill.charges[0].amount, 130); assert.equal(bill.total, 2929); ok("the bill shows the selling price and the courier as separate lines");
  await wa(`cancel ${o.code}`);
  o = await post("/api/orders", { ...ship, pin: "190001" });
  const C = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../shop.json"), "utf8")).policy.courier;
  const { feeFor, kgOf } = await import("../lib/courier.js").then((m) => m.default || m);
  const inKashmir = feeFor(C, kgOf(C, await product("b2")), "190001").fee;
  assert.equal(o.shipping, inKashmir); assert.equal(o.amount, 2799 + inKashmir); ok("inside Kashmir: per kg from shop.json, worked out by the server");
  assert.equal(feeFor(C, 0.95, "190001").fee, 100); assert.equal(feeFor(C, 1.9, "190001").fee, 200); assert.equal(feeFor(C, 2.1, "190001").fee, 300);
  assert.equal(feeFor(C, 0.4 * 2, "110001").fee, 130); ok("courier is charged per started kg: 0.95 kg = Rs 100, 1.9 kg = Rs 200, 2.1 kg = Rs 300");
  assert.equal(kgOf(C, { name: "Nuptse Puffer Jacket", category: "Clothing", subcategory: null }), 1.2);
  assert.equal(kgOf(C, { name: "Uspa Sweater", category: "Clothing", subcategory: null }), 0.6);
  assert.equal(kgOf(C, { name: "Bleu", category: "Fragrances", subcategory: "Perfume" }), 0.4);
  assert.equal(kgOf(C, { name: "Odd thing", category: "Clothing", subcategory: null, weightKg: 2.5 }), 2.5); ok("each piece's weight comes from its own weight, then its name/kind, then its category");

  // 8. Ten tills at once on 1 piece: exactly one bill
  await post("/api/billing/stock", { productId: "a1", quantity: 1 });
  const race = await Promise.all(Array.from({ length: 10 }, () => post("/api/billing/invoices", { lines: [{ productId: "a1", qty: 1 }] })));
  assert.equal(race.filter((x) => x.status === 200).length, 1); assert.equal((await product("a1")).quantity, 0); ok("10 simultaneous sales of the last piece -> 1 bill");

  // 9. Same item twice on one bill can't oversell
  await post("/api/billing/stock", { productId: "a1", quantity: 1 });
  r = await post("/api/billing/invoices", { lines: [{ productId: "a1", qty: 1 }, { productId: "a1", qty: 1 }] });
  assert.equal(r.status, 409); assert.equal((await product("a1")).quantity, 1); ok("duplicate lines can't oversell; nothing taken on failure");

  // 10. bills command, stats, numbering, bill page
  reply = await wa("bills"); assert.match(reply, /Today's bills/); assert.match(reply, /💬/); assert.match(reply, /🏬/); assert.match(reply, /🌐/);
  const st = await get("/api/stats"); assert.ok(st.billsToday >= 4);
  list = (await get("/api/billing/invoices")).invoices;
  const nums = list.map((x) => Number(x.number.split("/").pop())).sort((a, b) => a - b);
  assert.deepEqual(nums, nums.map((_, i) => 7651 + i));
  const page = await fetch(`${base}/bill/${list[0].id}`); const html = await page.text();
  assert.equal(page.status, 200); assert.match(html, new RegExp(list[0].number.replace(/\//g, "\\/"))); assert.match(html, /not registered under GST/);
  assert.equal((await fetch(`${base}/bill/0000000000000000`)).status, 404);
  ok("bills command, stats, gap-free numbers, printable bill page");

  console.log(`\nAll ${pass} billing checks passed.`);
} catch (e) {
  console.error("\nFAILED:", e); console.error(log.slice(-2000)); process.exitCode = 1;
} finally {
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
}
