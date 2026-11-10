// Hardening of lib/: staff lockout, size-aware returns, one-pass party balances, safe daily backup.
// Runs the real server for the returns part. `node tests/hardening-lib.mjs`
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, "..");
const SCRATCH = "/private/tmp/claude-501/-Users-saqlainsiddiqi-Desktop-SHINEY/f0e65a51-60d2-4cc2-b180-9421acc94b48/scratchpad/fixB";
const fresh = (name) => { const d = path.join(SCRATCH, `${name}-${process.pid}`); fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); return d; };
const { readJson, dailyBackup } = require("../lib/jsonstore.js");
let pass = 0; const ok = (n) => { pass++; console.log("  ✓", n); };

// ---- 1. Staff lockout ----
{
  const createStaff = require("../lib/staff.js");
  const staff = createStaff({ STORE: fresh("staff") });
  assert.ok(staff.add({ name: "Ali", pin: "4321" }).staff);
  assert.ok(staff.add({ name: "Bob", pin: "1111" }).staff);
  for (let i = 0; i < 5; i++) assert.equal(staff.login({ name: i % 2 ? " ALI " : i === 2 ? "ali  " : " ali", pin: "0000" }, "1.1.1.1").status, 401);
  assert.equal(staff.login({ name: "Ali", pin: "4321" }, "1.1.1.1").status, 429, "padding and case variants share one counter");
  assert.ok(staff.login({ name: "Ali", pin: "4321" }, "2.2.2.2").token, "another address is not locked by the per-address count");
  ok("padded names share one lockout counter");

  for (let i = 0; i < 10; i++) assert.equal(staff.login({ name: "bob", pin: "0000" }, `9.9.9.${i}`).status, 401);
  assert.equal(staff.login({ name: "Bob", pin: "1111" }, "8.8.8.8").status, 429, "10 wrong PINs from 10 addresses lock the name");
  ok("a name is locked across addresses after 10 wrong PINs");

  for (let i = 0; i < 5; i++) assert.equal(staff.login({ name: "Nobody", pin: "0000" }, "3.3.3.3").status, 401);
  assert.equal(staff.login({ name: " nobody", pin: "0000" }, "3.3.3.3").status, 429, "unknown names are counted too");
  ok("unknown names are counted and locked");
}

// ---- 4. Daily backup never copies a damaged file ----
{
  const store = fresh("backup");
  fs.writeFileSync(path.join(store, "a.json"), JSON.stringify([1]));
  fs.writeFileSync(path.join(store, "b.json"), "{ half a file");
  const old = path.join(store, "backups", "2020-01-01"); fs.mkdirSync(old, { recursive: true }); fs.writeFileSync(path.join(old, "b.json"), "[\"good\"]");
  const errs = []; const e = console.error; console.error = (...a) => errs.push(a.join(" "));
  const dest = dailyBackup(store, ["a.json", "b.json", "missing.json"], 30);
  console.error = e;
  assert.deepEqual(readJson(path.join(dest, "a.json")), [1]);
  assert.ok(!fs.existsSync(path.join(dest, "b.json")), "the damaged file isn't copied");
  assert.ok(errs.some((m) => m.includes("b.json")), "and the error is logged");
  assert.deepEqual(readJson(path.join(old, "b.json")), ["good"], "older good backups stay");
  fs.writeFileSync(path.join(store, "b.json"), "[2]"); dailyBackup(store, ["a.json", "b.json"], 30);
  assert.deepEqual(readJson(path.join(dest, "b.json")), [2], "once repaired, the next run backs it up");
  for (const d of ["2020-01-02", "2020-01-03"]) fs.mkdirSync(path.join(store, "backups", d));
  dailyBackup(store, ["a.json"], 2);
  assert.deepEqual(fs.readdirSync(path.join(store, "backups")).sort().length, 2, "keep still trims old days");
  ok("daily backup skips damaged files, keeps older copies and still trims");
}

// ---- 3. Party balances in one pass ----
{
  const createBooks = require("../lib/books.js");
  const dir = fresh("books"); let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const put = (n, v) => fs.writeFileSync(path.join(dir, `${n}.json`), JSON.stringify(v));
  const P = 300, party = () => `p${Math.floor(rnd() * P)}`;
  put("parties", Array.from({ length: P }, (_, i) => ({ id: `p${i}`, type: i % 4 ? "customer" : "supplier", name: `P${i}`, phone: "", opening: Math.round(rnd() * 1000) / 10, createdAt: "2026-04-01T00:00:00.000Z" })));
  put("invoices", Array.from({ length: 2000 }, (_, i) => { const t = Math.round(rnd() * 500000) / 100; return { id: `i${i}`, number: `${i}`, partyId: party(), status: i % 40 ? "done" : "cancelled", at: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T0${i % 9}:00:00.000Z`, total: t, taxable: t, paid: i % 2 ? t : Math.round(t / 3 * 100) / 100, payment: "credit", lines: [] }; }));
  put("purchases", Array.from({ length: 200 }, (_, i) => ({ id: `b${i}`, number: `PB${i}`, partyId: party(), day: "2026-10-05", at: "2026-10-05T05:00:00.000Z", total: 333.33, paid: 100.1, status: "done", lines: [] })));
  put("payments", Array.from({ length: 500 }, (_, i) => ({ id: `y${i}`, number: `R${i}`, partyId: party(), direction: i % 3 ? "in" : "out", amount: Math.round(rnd() * 90000) / 100, mode: "cash", day: "2026-10-10", at: "2026-10-10T05:00:00.000Z", status: i % 30 ? "done" : "cancelled" })));
  put("returns", Array.from({ length: 80 }, (_, i) => ({ id: `r${i}`, number: `SR${i}`, kind: ["sale_return", "credit_note", "purchase_return", "debit_note"][i % 4], partyId: party(), day: "2026-10-12", at: "2026-10-12T05:00:00.000Z", total: 77.77, refund: i % 2 ? 10.1 : 0, lines: [], status: "done" })));
  const billing = { loadInvoices: () => readJson(path.join(dir, "invoices.json"), []), stockOf: () => 0, gstOn: () => false };
  const books = createBooks({ STORE: dir, SHOP: {}, billing, load: () => [], save() {}, logActivity() {} });
  let reads = 0; const realRead = fs.readFileSync; fs.readFileSync = function (f, ...a) { if (String(f).startsWith(dir)) reads++; return realRead.call(this, f, ...a); };
  const t0 = Date.now(), list = books.partyList(); const ms = Date.now() - t0;
  fs.readFileSync = realRead;
  assert.ok(reads <= 6, `files read once per call, not once per party (${reads} reads)`);
  assert.equal(list.length, P);
  for (const x of list) assert.equal(x.balance, books.ledger(x.id).balance || 0, `balance of ${x.id} matches its ledger`);
  assert.ok(ms < 1500, `partyList took ${ms} ms`);
  const dues = books.billDues();
  assert.ok(dues instanceof Map);
  ok(`partyList reads each file once, and matches every ledger (${ms} ms for ${P} parties)`);
}

// ---- 2. Returns restore the right size ----
{
  const PORT = 20000 + Math.floor(Math.random() * 20000), dir = fresh("returns");
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(dir, "products.json"), JSON.stringify([{ id: "t1", code: "2001", name: "Tee", category: "Clothing", price: 1000, cost: 400, sizes: "S · M", sizeStock: { S: 2, M: 2 }, quantity: 4, status: "available", createdAt: now }]));
  const srv = spawn(process.execPath, ["server.js"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, ORDER_HOURS: "0-24", OWNER_KEY: "k", WA_TOKEN: "", ANTHROPIC_API_KEY: "", PUBLIC_URL: "" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
  const base = `http://127.0.0.1:${PORT}`, H = { "Content-Type": "application/json", "x-owner-key": "k" };
  try {
    for (let i = 0; i < 60; i++) { try { await fetch(base + "/api/products"); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    const post = async (p, b = {}) => { const r = await fetch(base + "/api/billing" + p, { method: "POST", headers: H, body: JSON.stringify(b) }); return { status: r.status, ...(await r.json()) }; };
    const sizes = async () => (await (await fetch(base + "/api/billing/products", { headers: H })).json()).find((p) => p.id === "t1").sizeStock;
    let r = await post("/invoices", { lines: [{ productId: "t1", qty: 1, size: "M" }], payment: "cash" });
    assert.equal(r.status, 200); assert.deepEqual(await sizes(), { S: 2, M: 1 });
    r = await post("/returns", { kind: "sale_return", invoiceId: r.invoice.id, lines: [{ productId: "t1", qty: 1 }], refund: 1000, mode: "cash" });
    assert.equal(r.status, 200); assert.equal(r.return.lines[0].sizes, "M", "the return line carries the size");
    assert.deepEqual(await sizes(), { S: 2, M: 2 }, "the returned piece goes back to M, not the first size");
    r = await post(`/returns/${r.return.id}/cancel`); assert.equal(r.status, 200);
    assert.deepEqual(await sizes(), { S: 2, M: 1 }, "undoing the return takes it from M");
    ok("a sale return and its undo move the size's own stock");

    // Same product in two sizes on one bill: each size can be returned on its own.
    r = await post("/invoices", { lines: [{ productId: "t1", qty: 1, size: "S" }, { productId: "t1", qty: 1, size: "M" }], payment: "cash" });
    assert.equal(r.status, 200); const bill = r.invoice, before = await sizes();
    assert.equal(bill.lines.length, 2);
    r = await post("/returns", { kind: "sale_return", invoiceId: bill.id, lines: [{ productId: "t1", sizes: "M", qty: 1 }], refund: 1000, mode: "cash" });
    assert.equal(r.status, 200, JSON.stringify(r)); assert.equal(r.return.lines[0].sizes, "M");
    assert.deepEqual(await sizes(), { S: before.S, M: before.M + 1 });
    r = await post("/returns", { kind: "sale_return", invoiceId: bill.id, lines: [{ productId: "t1", sizes: "M", qty: 1 }], refund: 1000, mode: "cash" });
    assert.equal(r.status, 409, "M is already returned");
    r = await post("/returns", { kind: "sale_return", invoiceId: bill.id, lines: [{ productId: "t1", sizes: "S", qty: 1 }], refund: 1000, mode: "cash" });
    assert.equal(r.status, 200, "the S line can still be returned"); assert.deepEqual(await sizes(), { S: before.S + 1, M: before.M + 1 });
    r = await post("/returns", { kind: "sale_return", invoiceId: bill.id, lines: [{ productId: "t1", sizes: "L", qty: 1 }] });
    assert.equal(r.status, 409, "a size that isn't on the bill is refused");
    ok("returns match the bill line by product and size");
  } catch (e) { console.log(log.slice(-1500)); throw e; }
  finally { srv.kill(); }
}

console.log(`\nall ${pass} hardening checks passed`);
process.exit(0);
