// Staff logins, what they can't do, item editing, labels data, shared ledgers, settings.
// Runs the real server. `node tests/staff.mjs`
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const PORT = 4798;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibex-staff-"));
fs.writeFileSync(path.join(dir, "products.json"), JSON.stringify([{ id: "a1", code: "1001", name: "Tee", category: "Clothing", price: 1000, cost: 400, supplierId: "s", quantity: 5, status: "available", createdAt: new Date().toISOString() }]));
const srv = spawn(process.execPath, ["server.js"], { cwd: path.resolve(import.meta.dirname, ".."), env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_KEY: "k", WA_TOKEN: "", ANTHROPIC_API_KEY: "", PUBLIC_URL: "" }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
const base = `http://127.0.0.1:${PORT}`, A = "/api/billing";
for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/products"); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
const call = async (p, b, h = { "x-owner-key": "k" }, method = b === undefined ? "GET" : "POST") => { const r = await fetch(base + A + p, { method, headers: { "Content-Type": "application/json", ...h }, ...(b !== undefined ? { body: JSON.stringify(b) } : {}) }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
const own = call;
let pass = 0; const ok = (n) => { pass++; console.log("  ✓", n); };

try {
  assert.equal((await own("/staff", { name: "Asif", pin: "12" })).status, 409);
  assert.equal((await own("/staff", { name: "Asif", pin: "4321" })).status, 200);
  assert.equal((await own("/staff", { name: "asif", pin: "9999" })).status, 409); ok("staff need a 4-6 digit PIN and a unique name");
  assert.ok(!fs.readFileSync(path.join(dir, "staff.json"), "utf8").includes("4321")); ok("PINs aren't stored");

  assert.equal((await call("/login", { name: "Asif", pin: "0000" }, {})).status, 401);
  let r = await call("/login", { name: "asif", pin: "4321" }, {}); assert.equal(r.status, 200);
  const S = { "x-session": r.json.token }; ok("login works, wrong PIN doesn't");
  assert.equal((await call("/me", undefined, S)).json.role, "staff");

  // What staff get
  let p = (await call("/products", undefined, S)).json; assert.equal(p[0].cost, undefined); assert.equal(p[0].supplierId, undefined);
  r = await call("/invoices", { lines: [{ productId: "a1", qty: 1 }], payment: "cash" }, S);
  assert.equal(r.status, 200); assert.equal(r.json.invoice.lines[0].cost, undefined); assert.equal(r.json.invoice.by, "Asif");
  const bills = (await call("/invoices", undefined, S)).json; assert.equal(bills.invoices[0].lines[0].cost, undefined); assert.equal(bills.today.total, 0); ok("staff can bill, and never receive cost prices or takings");
  const id = bills.invoices[0].id;
  for (const [route, body] of [["/dashboard"], ["/reports"], ["/reports/pnl"], ["/reports/stock.csv"], ["/cash"], ["/expenses"], ["/purchases"], ["/staff"], ["/settings"], ["/payments"], [`/invoices/${id}/cancel`, {}], ["/stock", { productId: "a1", quantity: 99 }], ["/items/a1", { price: 1 }], ["/staff", { name: "X", pin: "1234" }], ["/import", {}], ["/returns", {}], ["/docs", {}], ["/settings", { gstin: "" }]]) assert.equal((await call(route, body, S)).status, 403, route);
  ok("the server refuses staff everywhere else, not just the menu");
  assert.equal((await call("/products", undefined, {})).status, 401);
  assert.equal((await call("/products", undefined, { "x-session": "nonsense" })).status, 401); ok("no login, no access");

  // Credit limit can't be overridden by staff
  const party = (await own("/parties", { name: "Bilal", phone: "9876543210", creditLimit: 100 })).json.party;
  assert.equal((await call("/invoices", { partyId: party.id, lines: [{ productId: "a1", qty: 1, price: 1000 }], payment: "credit", overLimit: true }, S)).status, 409); ok("staff can't push past a credit limit");

  // PIN lockout
  for (let i = 0; i < 5; i++) await call("/login", { name: "Asif", pin: "0000" }, {});
  r = await call("/login", { name: "Asif", pin: "4321" }, {}); assert.equal(r.status, 429); ok("five wrong PINs lock the login");

  // Removing staff ends the session at once
  const sid = (await own("/staff")).json[0].id; await own(`/staff/${sid}/remove`, {});
  assert.equal((await call("/me", undefined, S)).status, 401); ok("removing staff ends their login straight away");

  // Items
  assert.equal((await own("/items", { name: "" })).status, 409);
  r = await own("/items", { name: "New Cap", category: "Accessories", price: 500, cost: 200, mrp: 999, quantity: 3, barcode: "111122223333", reorderAt: 2, hsn: "6505" });
  assert.equal(r.status, 200); const cap = r.json.product; assert.equal(cap.hidden, true); assert.match(cap.code, /^\d{4}$/);
  assert.ok(!(await (await fetch(base + "/api/products")).json()).some((x) => x.id === cap.id)); ok("new items stay off the website until they have a photo");
  assert.equal((await own("/items", { name: "Dup", barcode: "111122223333" })).status, 409);
  assert.equal((await own(`/items/${cap.id}`, { hsn: "12" })).status, 409);
  r = await own(`/items/${cap.id}`, { price: 550, gstRate: 12 }); assert.equal(r.json.product.price, 550); assert.equal(r.json.product.mrp, 999); assert.equal(r.json.product.gstRate, 12); ok("editing validates and leaves other fields alone");
  r = await own("/barcodes", { ids: ["a1", cap.id] }); assert.deepEqual(r.json.done, ["a1"]);
  const a1 = (await own("/products")).json.find((x) => x.id === "a1"); assert.match(a1.barcode, /^2\d{11}$/);
  assert.equal((await (await fetch(base + "/api/products")).json()).find((x) => x.id === "a1").barcode, undefined); ok("missing barcodes get generated, existing ones kept, none public");

  // Shared ledger
  await own("/payments", { direction: "in", partyId: party.id, amount: 1, mode: "cash" }).catch(() => {});
  r = await own(`/parties/${party.id}/share`, { on: true }); const t = r.json.token; assert.match(t, /^[a-f0-9]{32}$/);
  let pg = await fetch(`${base}/l/${t}`); assert.equal(pg.status, 200); const html = await pg.text(); assert.ok(html.includes("Bilal")); assert.ok(html.includes("Payment in")); ok("a shared ledger opens without a login");
  await own(`/parties/${party.id}/share`, { on: false });
  assert.equal((await fetch(`${base}/l/${t}`)).status, 404); ok("stopping sharing kills the link");
  assert.ok(!html.includes("cost")); 

  // Settings
  assert.equal((await own("/settings", { gstin: "BAD" })).status, 409);
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  r = await own("/settings", { theme: "navy", terms: "Exchange in 7 days", logoData: PNG }); assert.equal(r.status, 200);
  const inv = (await own("/invoices", { lines: [{ productId: "a1", qty: 1 }] })).json.invoice;
  let bill = await (await fetch(`${base}/bill/${inv.id}`)).text();
  assert.ok(bill.includes("Exchange in 7 days")); assert.ok(bill.includes("#12305c")); assert.ok(/<img class="logo" src="\/uploads\/logo-/.test(bill)); ok("logo, terms and theme reach the bill");
  await own("/settings", { gstin: "01ABCDE1234F1Z5" });
  const inv2 = (await own("/invoices", { lines: [{ productId: "a1", qty: 1, price: 1000 }] })).json.invoice;
  assert.equal(inv2.kind, "tax-invoice"); assert.equal(inv2.lines[0].gstRate, 5); assert.equal(inv2.lines[0].tax, 47.62); ok("adding a GSTIN turns on tax invoices for new bills");
  await own("/settings", { gstin: "" });
  assert.equal((await own("/invoices", { lines: [{ productId: "a1", qty: 1 }] })).json.invoice.kind, "cash-memo"); ok("clearing it turns them off again");

  // AI scan without a key
  r = await own("/purchases/scan", { image: PNG }); assert.equal(r.status, 503); assert.match(r.json.error, /API key/); ok("bill scanning says clearly when it isn't set up");

  console.log(`\nAll ${pass} staff and settings checks passed.`);
} catch (e) { console.error("\nFAILED:", e); console.error(log.slice(-1200)); process.exitCode = 1; }
finally { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
