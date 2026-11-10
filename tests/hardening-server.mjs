// Server hardening: bad URLs, WhatsApp retries after a restart, commands that must not guess,
// photo-only posts, order cancel with a bill that can't be cancelled, credit and staff limits,
// requestId repeats, client addresses, held alerts and SIGTERM. Runs the real server against a
// fake Meta Graph API on random ports. `node tests/hardening-server.mjs`
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const OWNER = "919000000009";
const SECRET = "test-secret";
const ROOT = process.env.HARDEN_TMP || os.tmpdir();
fs.mkdirSync(ROOT, { recursive: true });
const dir = fs.mkdtempSync(path.join(ROOT, "vibex-harden-"));
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });

const old = new Date(Date.now() - 864e5).toISOString();
const item = (id, code, name, price, quantity, extra = {}) => ({ id, code, name, category: "Clothing", price, quantity, status: "available", sizes: "M", caption: name, createdAt: old, ...extra });
fs.writeFileSync(path.join(dir, "products.json"), JSON.stringify([
  item("z1", "1111", "Zara Shirt", 1499, 3, { brand: "Zara", caption: "Zara shirt 1499" }),
  item("z2", "2222", "Zara Jacket", 2999, 2, { brand: "Zara" }),
  item("p1", "3333", "North Face Puffer", 4999, 5),
  item("s1", "6666", "Steel Bottle", 499, 4, { category: "Accessories", sizes: "" }), // before the tee: "tee" is inside "Steel"
  item("t1", "5555", "Plain Tee", 999, 9),
]));

// ---- fake Meta ----
const sent = [];
const fail = { template: false, text: false };
const graph = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    if (req.url.endsWith("/messages")) {
      const m = JSON.parse(b);
      if ((m.type === "template" && fail.template) || (m.type !== "template" && fail.text)) { res.statusCode = 500; return res.end(JSON.stringify({ error: { message: "fake outage", code: 1 } })); }
      sent.push(m);
      return res.end(JSON.stringify({ messages: [{ id: "wamid.x" }] }));
    }
    if (req.url.startsWith("/media-file")) { res.setHeader("Content-Type", "image/png"); return res.end(PNG); }
    if (req.url.startsWith("/heic-file")) { res.setHeader("Content-Type", "image/heic"); return res.end(Buffer.from("not really heic")); }
    if (/\/mediabad/.test(req.url)) { res.statusCode = 404; return res.end(JSON.stringify({ error: { message: "gone" } })); }
    if (/\/mediaheic/.test(req.url)) return res.end(JSON.stringify({ url: `http://127.0.0.1:${graph.address().port}/heic-file`, mime_type: "image/heic" }));
    if (/\/mediahuge/.test(req.url)) return res.end(JSON.stringify({ url: `http://127.0.0.1:${graph.address().port}/media-file`, mime_type: "image/png", file_size: 40 * 1024 * 1024 }));
    if (/\/media\d/.test(req.url)) return res.end(JSON.stringify({ url: `http://127.0.0.1:${graph.address().port}/media-file`, mime_type: "image/png" }));
    res.end("{}");
  });
});
await new Promise((r) => graph.listen(0, "127.0.0.1", r));

let PORT, base, srv, log = "";
async function start(extra = {}) {
  PORT = await freePort();
  base = `http://127.0.0.1:${PORT}`;
  srv = spawn(process.execPath, ["server.js"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, ORDER_HOURS: "0-24", OWNER_KEY: "k", WA_TOKEN: "t", WA_PHONE_ID: "123", WA_APP_SECRET: SECRET,
      OWNER_WHATSAPP: OWNER, WA_ALBUM_MS: "300", WA_RETRY_MS: "100", DRAFT_STALE_MS: "600000", PUBLIC_URL: "", RENDER: "", WA_GRAPH_URL: `http://127.0.0.1:${graph.address().port}`, ANTHROPIC_API_KEY: "", ...extra },
    stdio: ["ignore", "pipe", "pipe"],
  });
  srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 80; i++) { try { await fetch(`${base}/api/products`); return; } catch { await wait(100); } }
  throw new Error("server didn't start");
}
const stop = (sig = "SIGTERM") => new Promise((r) => { if (!srv || srv.exitCode !== null) return r(srv?.exitCode); srv.once("exit", (code) => r(code)); srv.kill(sig); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok ${++n} - ${name}`); }
  catch (e) { failed++; console.log(`not ok ${++n} - ${name}\n  ${e.stack || e.message}`); }
}

const J = { "Content-Type": "application/json" };
const ownerH = { ...J, "x-owner-key": "k" };
const api = async (p, b, headers = ownerH, method = b === undefined ? "GET" : "POST") => {
  const r = await fetch(base + p, { method, headers, body: b === undefined ? undefined : JSON.stringify(b) });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
const products = () => JSON.parse(fs.readFileSync(path.join(dir, "products.json"), "utf8"));
const qty = (id) => products().find((p) => p.id === id).quantity;
const invoices = () => { try { return JSON.parse(fs.readFileSync(path.join(dir, "invoices.json"), "utf8")); } catch { return []; } };
const pending = () => { try { return JSON.parse(fs.readFileSync(path.join(dir, "pending.json"), "utf8")); } catch { return []; } };
const heldAlerts = () => { try { return JSON.parse(fs.readFileSync(path.join(dir, "wa-alerts.json"), "utf8")); } catch { return {}; } };

// One WhatsApp message from the owner; returns the text of every reply Meta was asked to send.
let seq = 0;
async function wa(message, { id = `wamid.h${++seq}`, expect = 1, ms = 3000 } = {}) {
  sent.length = 0;
  const raw = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id, from: OWNER, ...message }] } }] }] });
  const sig = "sha256=" + crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
  const r = await fetch(`${base}/webhook`, { method: "POST", headers: { ...J, "X-Hub-Signature-256": sig }, body: raw });
  assert.equal(r.status, 200);
  for (let i = 0; i < ms / 50 && sent.length < expect; i++) await wait(50);
  await wait(expect ? 150 : ms);
  return sent.map((m) => m.interactive?.body?.text || m.text?.body || m.image?.caption || "");
}
const say = (t, o) => wa({ type: "text", text: { body: t } }, o);
const one = async (t) => { const r = await say(t); assert.equal(r.length, 1, `one reply to “${t}”: ${JSON.stringify(r)}`); return r[0]; };

// Raw HTTP, so the request line and Host header are exactly as written.
const rawGet = (line, host = "x") => new Promise((resolve) => {
  const s = net.connect(PORT, "127.0.0.1", () => s.write(`${line}\r\nHost: ${host}\r\nConnection: close\r\n\r\n`));
  let out = ""; s.on("data", (d) => (out += d)); s.on("end", () => resolve(out)); s.on("error", () => resolve(out));
});

try {
  await start();

  // ---- held alerts first, while the owner is outside the 24 h window (no message yet) ----
  await check("a template that fails is retried and shows in pulse as alertFailures; the alert is held", async () => {
    fail.template = true;
    const r = await api("/api/enquiry", { productId: "z1", name: "Sana", phone: "9876543210" }, J);
    assert.equal(r.status, 200);
    await wait(700); // first try + retry after WA_RETRY_MS
    const pulse = await api("/api/billing/pulse");
    assert.ok(Array.isArray(pulse.alertFailures) && pulse.alertFailures.length >= 2, `retried and recorded: ${JSON.stringify(pulse.alertFailures)}`);
    assert.ok(pulse.alertFailures.every((f) => f.at && f.error && /template/.test(f.kind)));
    assert.equal(heldAlerts()[OWNER].length, 1);
    fail.template = false;
    const staffView = await api("/api/billing/pulse", undefined, { "x-session": "nope" });
    assert.equal(staffView.status, 401);
  });
  await check("a held alert stays on the disk until it was really sent", async () => {
    fail.text = true;
    await say("stats", { expect: 0, ms: 800 });
    assert.equal(heldAlerts()[OWNER].length, 1, "send failed: still held");
    fail.text = false;
    const r = await say("stats", { expect: 2 });
    assert.ok(r.some((t) => /Enquiry from the website/.test(t)), JSON.stringify(r));
    assert.deepEqual(heldAlerts(), {});
  });

  // ---- 1. bad URLs ----
  await check("a broken path or Host header is a 400, and the server stays up", async () => {
    assert.match(await rawGet("GET /%E0%A4%A HTTP/1.1"), /^HTTP\/1\.1 400/);
    assert.match(await rawGet("GET / HTTP/1.1", "[::1"), /^HTTP\/1\.1 400/);
    assert.match(await rawGet("GET /p/%ZZ HTTP/1.1"), /^HTTP\/1\.1 400/);
    await wait(100);
    assert.equal(srv.exitCode, null, "still running");
    assert.equal((await fetch(`${base}/api/products`)).status, 200);
  });

  // ---- 4. commands that must not guess ----
  await check("bare “sold” asks which item and sells nothing", async () => {
    const before = invoices().length;
    assert.match(await one("sold"), /Which item\?.*sold 4795/s);
    assert.match(await one("remove"), /Which item\?/);
    assert.equal(invoices().length, before);
    assert.equal(products().filter((p) => p.hidden).length, 0);
  });
  await check("“sold 149” is an error, not the ₹1499 Zara shirt", async () => {
    const before = invoices().length;
    assert.match(await one("sold 149"), /isn't a code/);
    assert.equal(invoices().length, before);
    assert.equal(qty("z1"), 3);
  });
  await check("“sold zara” with two Zara items lists both codes and does nothing", async () => {
    const r = await one("sold zara");
    assert.match(r, /1111/); assert.match(r, /2222/); assert.match(r, /Which one/);
    assert.equal(qty("z1"), 3); assert.equal(qty("z2"), 2);
  });
  await check("whole words only: “sold tee” doesn't match “Steel”, but does match Plain Tee", async () => {
    const r = await one("sold tee");
    assert.match(r, /Plain Tee/); assert.equal(qty("t1"), 8); assert.equal(qty("s1"), 4);
  });
  await check("“bik gaya 1111”, “sold 1,111”, “sold #1111” and “becha 5555” sell by code", async () => {
    assert.match(await one("bik gaya 1111"), /Sold 1 × “Zara Shirt”/); assert.equal(qty("z1"), 2);
    assert.match(await one("sold 1,111"), /Sold 1 × “Zara Shirt”/); assert.equal(qty("z1"), 1);
    assert.match(await one("sold #1111"), /Sold 1 × “Zara Shirt”/); assert.equal(qty("z1"), 0);
    assert.match(await one("add 1111 3"), /Added 3/); assert.equal(qty("z1"), 3);
    assert.match(await one("becha 5555"), /Plain Tee/); assert.equal(qty("t1"), 7);
  });
  await check("“stock” and “orders” answer instead of becoming drafts", async () => {
    assert.match(await one("stock"), /Stock:.*stock 4795 5/s);
    assert.match(await one("orders"), /No website orders waiting/);
    assert.equal(pending().length, 0);
  });

  // ---- 5. no photo, no draft ----
  await check("text with no photo never starts a draft", async () => {
    const r = await one("Zara shirt 1499 M L");
    assert.match(r, /send its \*photo\*/);
    assert.equal(pending().length, 0);
    const live = products().length;
    assert.match(await one("ok"), /Nothing is waiting/);
    assert.equal(products().length, live);
  });

  // ---- 6. media ----
  await check("a video is refused and nothing goes live", async () => {
    const live = products().length;
    const r = await wa({ type: "video", video: { id: "vid1", caption: "Zara shirt 1499 M" } });
    assert.equal(r.length, 1); assert.match(r[0], /only use photos \(JPG\/PNG\)/);
    assert.equal(products().length, live); assert.equal(pending().length, 0);
    assert.ok(!/It's live|on your website/i.test(r[0]));
  });
  await check("a HEIC file is refused; a 40 MB file is refused before download", async () => {
    let r = await wa({ type: "document", document: { id: "mediaheic", mime_type: "image/heic", caption: "Zara 999 M" } });
    assert.match(r[0], /only use photos/); assert.equal(pending().length, 0);
    r = await wa({ type: "image", image: { id: "mediahuge" } });
    assert.match(r[0], /too big/); assert.equal(pending().length, 0);
  });
  await check("an album where one download fails says so", async () => {
    sent.length = 0;
    const raw = JSON.stringify({ entry: [{ changes: [{ value: { messages: [
      { id: "wamid.al1", from: OWNER, type: "image", image: { id: "media1", caption: "Zara shirt 1499 M" } },
      { id: "wamid.al2", from: OWNER, type: "image", image: { id: "mediabad" } },
    ] } }] }] });
    const sig = "sha256=" + crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
    await fetch(`${base}/webhook`, { method: "POST", headers: { ...J, "X-Hub-Signature-256": sig }, body: raw });
    for (let i = 0; i < 60 && !sent.length; i++) await wait(50);
    await wait(150);
    const t = sent.map((m) => m.interactive?.body?.text || m.text?.body || "").join("\n");
    assert.match(t, /1 of 2 photos couldn't be downloaded, please resend those/);
    assert.equal(pending().length, 1, "the photo that did arrive is a draft");
  });

  // ---- 7. commands while a draft waits ----
  await check("while a draft waits, “sold puffer” runs as a command and isn't taken as an answer", async () => {
    const d = pending()[0];
    assert.ok(d && d.image);
    const r = await one("sold puffer");
    assert.match(r, /North Face Puffer/); assert.equal(qty("p1"), 4);
    assert.ok(!/sold puffer/i.test(pending()[0].listing.name));
    assert.match(await one("remove 3333"), /off the website/);
    assert.equal(products().find((p) => p.id === "p1").hidden, true);
    assert.equal(pending().length, 1, "the draft is still there");
  });
  await check("“ok” publishes only from the preview, never while a question is open", async () => {
    const live = products().length;
    assert.match(await one("change"), /What do you want to change/);
    let r = await one("ok");
    assert.equal(products().length, live, "not published from the Change menu");
    assert.match(r, /Pick what to change/);
    r = await one("Quantity");
    assert.match(r, /How many pieces/);
    r = await one("haan");
    assert.equal(products().length, live, "not published while asking for the quantity");
    assert.match(r, /How many pieces/);
    r = await one("2");
    assert.match(r, /Post it\?/);
    r = await one("ok");
    assert.equal(products().length, live + 1, "published from the preview");
    assert.equal(pending().length, 0);
    assert.ok(products()[0].image, "with its photo");
  });

  // ---- 9. cancel with a bill that can't be cancelled ----
  await check("cancel VX-… stops when the bill can't be cancelled, and the order is unchanged", async () => {
    const o = await api("/api/orders", { name: "Imran", phone: "9876500001", delivery: "pickup", lines: [{ id: "z2" }] }, { ...J, "cf-connecting-ip": "10.9.9.1", "x-forwarded-for": "172.70.3.3" });
    assert.equal(o.status, 200, JSON.stringify(o));
    const c = await api("/api/message", { text: `confirm ${o.code}` });
    assert.match(c.reply, /confirmed/);
    const inv = invoices().at(-1);
    const ret = await api("/api/billing/returns", { kind: "sale_return", invoiceId: inv.id, lines: [{ productId: "z2", qty: 1 }], reason: "Size" });
    assert.equal(ret.status, 200, JSON.stringify(ret));
    const x = await api("/api/message", { text: `cancel ${o.code}` });
    assert.match(x.reply, /Can't cancel/);
    const orders = JSON.parse(fs.readFileSync(path.join(dir, "orders.json"), "utf8"));
    const after = orders.find((y) => y.code === o.code);
    assert.equal(after.status, "confirmed"); assert.equal(after.invoice, inv.id);
    assert.equal(invoices().find((y) => y.id === inv.id).status, "paid");
  });

  // ---- 11. credit limit ----
  await check("a credit bill with no line price is checked on the listed price, so it's refused over the limit", async () => {
    const party = await api("/api/billing/parties", { name: "Bilal", phone: "9876500002", creditLimit: 1000 });
    assert.equal(party.status, 200, JSON.stringify(party));
    const before = invoices().length;
    const r = await api("/api/billing/invoices", { payment: "credit", partyId: party.party?.id || party.id, lines: [{ productId: "t1", qty: 2 }] });
    assert.equal(r.status, 409, JSON.stringify(r)); assert.equal(r.overLimit, true);
    assert.equal(invoices().length, before);
  });

  // ---- 12. staff limits ----
  let session;
  await check("staff can't bill ₹0, below 20% off, or sell short; the owner can", async () => {
    assert.equal((await api("/api/billing/staff", { name: "Asif", pin: "4321" })).status, 200);
    const login = await api("/api/billing/login", { name: "Asif", pin: "4321" }, J);
    session = login.token; assert.ok(session);
    const S = { ...J, "x-session": session };
    let r = await api("/api/billing/invoices", { lines: [{ productId: "t1", qty: 1, price: 0 }], payment: "cash" }, S);
    assert.equal(r.status, 409); assert.match(r.error, /₹0/);
    r = await api("/api/billing/invoices", { lines: [{ productId: "t1", qty: 1, price: 700 }], payment: "cash" }, S);
    assert.equal(r.status, 409);
    r = await api("/api/billing/invoices", { lines: [{ productId: "t1", qty: 50 }], payment: "cash", allowShort: true }, S);
    assert.equal(r.status, 409); assert.match(r.error, /Only \d+ ×/);
    r = await api("/api/billing/invoices", { lines: [{ productId: "t1", qty: 1, price: 800 }], payment: "cash" }, S);
    assert.equal(r.status, 200, JSON.stringify(r));
    r = await api("/api/billing/invoices", { lines: [{ productId: "t1", qty: 1, price: 0 }], payment: "cash" });
    assert.equal(r.status, 200, "owner keeps full control");
  });

  // ---- 13. requestId ----
  let first;
  await check("the same requestId twice returns the same bill with repeat: true, and only one bill exists", async () => {
    const before = invoices().length, stock = qty("t1");
    const b = { lines: [{ productId: "t1", qty: 1 }], payment: "cash", requestId: "tap-123" };
    const [a, c] = await Promise.all([api("/api/billing/invoices", b), api("/api/billing/invoices", b)]);
    first = a.repeat ? c : a;
    const second = a.repeat ? a : c;
    assert.equal(a.status, 200); assert.equal(c.status, 200);
    assert.equal(second.repeat, true); assert.ok(!first.repeat);
    assert.equal(second.invoice.id, first.invoice.id);
    assert.equal(invoices().length, before + 1); assert.equal(qty("t1"), stock - 1);
    const third = await api("/api/billing/invoices", { ...b, requestId: "tap-124" });
    assert.notEqual(third.invoice.id, first.invoice.id, "a new requestId is a new bill");
    const noId = await api("/api/billing/invoices", { lines: [{ productId: "t1", qty: 1 }], payment: "cash" });
    assert.equal(noId.status, 200); assert.ok(!noId.repeat);
    const pay = { partyId: (await api("/api/billing/parties")).find?.((x) => x.name === "Bilal")?.id, amount: 100, mode: "cash", direction: "in", requestId: "pay-1" };
    const p1 = await api("/api/billing/payments", pay), p2 = await api("/api/billing/payments", pay);
    assert.equal(p1.status, p2.status); assert.equal(p2.repeat, true);
    const err = await api("/api/billing/invoices", { lines: [{ productId: "t1", qty: 999 }], payment: "cash", requestId: "bad-1" });
    const err2 = await api("/api/billing/invoices", { lines: [{ productId: "t1", qty: 999 }], payment: "cash", requestId: "bad-1" });
    assert.equal(err.status, 409); assert.equal(err2.status, 409); assert.equal(err2.repeat, true);
  });

  // ---- 10. client address ----
  await check("rate limits use cf-connecting-ip, else the LAST x-forwarded-for entry; wrong keys are limited, the right key isn't", async () => {
    const enq = (h) => api("/api/enquiry", { productId: "t1", name: "A", phone: "9876543210" }, { ...J, ...h });
    // Cloudflare's header wins when the hop Render saw is a Cloudflare edge...
    for (let i = 0; i < 5; i++) assert.equal((await enq({ "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": `7.7.7.${i}, 172.70.0.${i}` })).status, 200);
    assert.equal((await enq({ "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "7.7.7.99, 162.158.1.1" })).status, 429);
    assert.equal((await enq({ "cf-connecting-ip": "1.1.1.2", "x-forwarded-for": "172.70.0.1" })).status, 200);
    // ...and is ignored from anyone else (straight to *.onrender.com), so it can't dodge the limit.
    for (let i = 0; i < 5; i++) assert.equal((await enq({ "cf-connecting-ip": `8.8.8.${i}`, "x-forwarded-for": "4.4.4.4" })).status, 200);
    assert.equal((await enq({ "cf-connecting-ip": "8.8.8.99", "x-forwarded-for": "4.4.4.4" })).status, 429);
    // No Cloudflare header: a made-up first entry doesn't help, the last (Render's) counts.
    for (let i = 0; i < 5; i++) assert.equal((await enq({ "x-forwarded-for": `spoof${i}, 5.5.5.5` })).status, 200);
    assert.equal((await enq({ "x-forwarded-for": "spoof-x, 5.5.5.5" })).status, 429);
    // Owner key guesses.
    const H = { "cf-connecting-ip": "6.6.6.6", "x-forwarded-for": "172.70.9.9" };
    for (let i = 0; i < 20; i++) assert.equal((await api("/api/billing/me", undefined, { ...H, "x-owner-key": `bad${i}` })).status, 401);
    assert.equal((await api("/api/billing/me", undefined, { ...H, "x-owner-key": "bad-21" })).status, 429);
    assert.equal((await api("/api/billing/me", undefined, { ...H, "x-owner-key": "k" })).status, 200, "the right key still works");
    assert.equal((await api("/api/billing/me", undefined, { "cf-connecting-ip": "6.6.6.7", "x-forwarded-for": "172.70.9.9", "x-owner-key": "bad" })).status, 401, "other addresses unaffected");
  });

  // ---- 2. a Meta retry after a restart ----
  await check("a WhatsApp retry after a restart doesn't sell twice; requestIds survive it too", async () => {
    const r1 = await say("sold 1111", { id: "wamid.retry-1" });
    assert.match(r1[0], /Sold 1 × “Zara Shirt”/);
    const after = qty("z1"), bills = invoices().length;
    await stop();
    await start({ WA_ALBUM_MS: "5000" });
    const r2 = await say("sold 1111", { id: "wamid.retry-1", expect: 0, ms: 1000 });
    assert.equal(r2.length, 0, `no reply to a retry: ${JSON.stringify(r2)}`);
    assert.equal(qty("z1"), after); assert.equal(invoices().length, bills);
    const again = await api("/api/billing/invoices", { lines: [{ productId: "t1", qty: 1 }], payment: "cash", requestId: "tap-123" });
    assert.equal(again.repeat, true); assert.equal(again.invoice.id, first.invoice.id); assert.equal(invoices().length, bills);
  });

  // ---- 3. SIGTERM while an album waits ----
  await check("SIGTERM during the album wait still answers the photo before exiting", async () => {
    sent.length = 0;
    const raw = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: "wamid.term1", from: OWNER, type: "image", image: { id: "media7", caption: "Levis jeans 1999 M" } }] } }] }] });
    const sig = "sha256=" + crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
    await fetch(`${base}/webhook`, { method: "POST", headers: { ...J, "X-Hub-Signature-256": sig }, body: raw });
    await wait(200); // album wait is 5 s on this server
    const t0 = Date.now();
    const code = await stop("SIGTERM");
    assert.equal(code, 0);
    assert.ok(Date.now() - t0 < 4000, "didn't sit out the 5 s album wait");
    assert.equal(sent.length, 1, `the photo was answered before exit: ${JSON.stringify(sent)}`);
    assert.ok(pending().some((x) => x.listing.name.includes("Levis") || x.listing.caption?.includes("Levis")), "the draft was saved");
    assert.match(log, /SIGTERM: finishing WhatsApp/);
  });
  await check("no unhandled errors in the server log", async () => {
    assert.ok(!/Unhandled rejection|Uncaught exception/.test(log), log.split("\n").filter((l) => /Unhandled|Uncaught/.test(l)).join("\n"));
  });

  console.log(`\n${n - failed} passed, ${failed} failed`);
  if (failed) console.log("--- server log ---\n" + log.slice(-4000));
} catch (e) {
  console.error(e); console.error("--- server log ---\n" + log.slice(-4000)); failed++;
} finally {
  await stop("SIGKILL");
  graph.close();
  fs.rmSync(dir, { recursive: true, force: true });
  process.exitCode = failed ? 1 : 0;
}
