// The "just bought" banner may only show real sales and a first name + city. `node tests/salebar.mjs`
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const PORT = 4793, base = `http://127.0.0.1:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibex-sales-"));
const ago = (m) => new Date(Date.now() - m * 60e3).toISOString();
const put = (name, data) => fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(data));
const item = (id, extra = {}) => ({ id, code: id, name: `Item ${id}`, price: 1000, quantity: 8, status: "available", image: `/uploads/${id}.jpg`, ...extra });
put("products", [item("a"), item("b"), item("c"), item("d"), item("e"), item("hid", { hidden: true, name: "-30 combodian HOUSE jacket" }), item("f"), item("old"), item("nn", { needsName: true }), item("g", { quantity: 1 }), item("h", { quantity: 0, status: "sold" }), item("z", { status: "hold", quantity: 1 })]);
put("orders", [
  { code: "VX-1", name: "aamir lone", phone: "9906111222", delivery: "ship", address: "12 Secret Lane", city: "Delhi", pin: "110001" },
  { code: "VX-2", name: "Sana Mir", phone: "9906333444", delivery: "pickup" },
  { code: "VX-3", name: "9906111222", phone: "9906111222", delivery: "pickup" },
  { code: "VX-4", name: "Iqra", phone: "9906555666", delivery: "ship", address: "x", city: "<script>", pin: "110001" },
  { code: "VX-5", name: "Zoya Khan", phone: "8899123456", delivery: "ship", address: "x", city: "Pune", pin: "411001", hideName: true },
]);
put("invoices", [
  { id: "i9", number: "9", status: "cancelled", lines: [] },
  { id: "i10", number: "10", status: "paid", lines: [], showName: true, customer: { name: "Bilal Shah", phone: "9419012345" } },
  { id: "i11", number: "11", status: "paid", lines: [], customer: { name: "Faisal Dar", phone: "7006222111" } },
]);
put("activity", [
  { type: "sold", id: "old", at: ago(8 * 24 * 60), invoice: "1" },
  { type: "sold", id: "hid", at: ago(9), invoice: "2", source: "counter" },
  { type: "sold", id: "nn", at: ago(9), invoice: "2", source: "counter" },
  { type: "sold", id: "g", at: ago(9), invoice: "10", source: "counter" },
  { type: "sold", id: "h", at: ago(9), invoice: "11", source: "counter" },
  { type: "sold", id: "f", at: ago(8), invoice: "9", order: "VX-1" },
  { type: "sold", id: "e", at: ago(5), invoice: "3", order: "VX-4" },
  { type: "sold", id: "d", at: ago(4), invoice: "4", order: "VX-3" },
  { type: "sold", id: "c", at: ago(3), invoice: "5", source: "counter" },
  { type: "sold", id: "b", at: ago(2), invoice: "6", order: "VX-2", qty: 2 },
  { type: "sold", id: "a", at: ago(1), invoice: "7", order: "VX-1" },
  { type: "sold", id: "z", at: ago(1), invoice: "12", order: "VX-5" },
]);

const srv = spawn(process.execPath, ["server.js"], { env: { ...process.env, PORT, DATA_DIR: dir, OWNER_KEY: "k", WA_TOKEN: "", ANTHROPIC_API_KEY: "", PUBLIC_URL: "" }, stdio: "ignore" });
let res;
for (let i = 0; i < 80 && !res; i++) { try { res = await fetch(`${base}/api/recent-sales`); } catch { await new Promise((r) => setTimeout(r, 100)); } }
const raw = await res.text(), sales = JSON.parse(raw);
const who = (id) => sales.find((s) => s.id === id)?.who;
let passed = 0, failed = 0;
const check = (name, fn) => { try { fn(); passed++; } catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); } };

check("first name and shipping city", () => assert.equal(who("a"), "Aamir from Delhi"));
check("pickup is Srinagar", () => assert.equal(who("b"), "Sana from Srinagar"));
check("counter sale stays anonymous", () => assert.equal(who("c"), "Someone in Srinagar"));
check("a number is never used as a name", () => assert.equal(who("d"), "Someone in Srinagar"));
check("a junk city is dropped", () => assert.equal(who("e"), "Iqra"));
check("a website buyer who opted out stays anonymous", () => assert.equal(who("z"), "Someone from Pune"));
check("cancelled bills don't show", () => assert.equal(who("f"), undefined));
check("store items not on the website show, without a link", () => { assert.equal(who("hid"), "Someone in Srinagar"); assert.equal(sales.find((x) => x.id === "hid").onSite, false); });
check("stock shorthand is tidied for customers", () => assert.equal(sales.find((x) => x.id === "hid").name, "Combodian House Jacket"));
check("low stock shows the real count", () => assert.equal(sales.find((x) => x.id === "g").left, 1));
check("sold out shows as zero", () => assert.equal(sales.find((x) => x.id === "h").left, 0));
check("plenty in stock claims no scarcity", () => assert.ok(!("left" in sales.find((x) => x.id === "b"))));
check("a piece on hold claims nothing", () => assert.ok(!("left" in sales.find((x) => x.id === "z"))));
check("stock count of items not on the website stays private", () => assert.ok(!("left" in sales.find((x) => x.id === "hid"))));
check("website items link to their page", () => assert.equal(sales.find((x) => x.id === "a").onSite, true));
check("items that still need a name don't show", () => assert.equal(who("nn"), undefined));
check("counter sale ticked to show a name", () => assert.equal(who("g"), "Bilal from Srinagar"));
check("counter sale not ticked stays anonymous", () => assert.equal(who("h"), "Someone in Srinagar"));
check("sales over a week old don't show", () => assert.equal(who("old"), undefined));
check("newest first", () => assert.equal(sales[0].id, "z"));
check("no surname, phone or address leaves the server", () => assert.ok(!/lone|mir"|shah|dar"|faisal|khan|zoya|9906|9419|7006|8899|Secret|110001/i.test(raw), raw));
srv.kill();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`salebar: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
