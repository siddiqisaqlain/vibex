// Guided posting over the real WhatsApp webhook: photo with no caption -> section menu ->
// name -> price -> size -> preview -> Change menu -> Post it. Runs the real server against a
// fake Meta Graph API and checks the exact messages Meta would be asked to send.
// `node tests/guided.mjs`
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const OWNER = "919000000003";
const SECRET = "test-secret";
const PORT = 4792;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibex-guided-"));
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const sent = [];
const graph = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    if (req.url.endsWith("/messages")) { sent.push(JSON.parse(b)); return res.end(JSON.stringify({ messages: [{ id: "wamid.x" }] })); }
    if (req.url.startsWith("/media-file")) { res.setHeader("Content-Type", "image/png"); return res.end(PNG); }
    if (/\/media\d/.test(req.url)) return res.end(JSON.stringify({ url: `http://127.0.0.1:${graph.address().port}/media-file`, mime_type: "image/png" }));
    res.end("{}");
  });
});
await new Promise((r) => graph.listen(0, "127.0.0.1", r));

const srv = spawn(process.execPath, ["server.js"], {
  cwd: path.resolve(import.meta.dirname, ".."),
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_KEY: "k", WA_TOKEN: "t", WA_PHONE_ID: "123", WA_APP_SECRET: SECRET,
    OWNER_WHATSAPP: OWNER, WA_ALBUM_MS: "400", DRAFT_STALE_MS: "1500", PUBLIC_URL: "https://shop.example", WA_GRAPH_URL: `http://127.0.0.1:${graph.address().port}`, ANTHROPIC_API_KEY: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 50; i++) { try { await fetch(`${base}/api/products`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
let n = 0, seq = 0;
const ok = (name) => console.log(`ok ${++n} - ${name}`);

// Sends one WhatsApp message from the owner and returns what the bot sent back.
async function owner(message) {
  sent.length = 0;
  const raw = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: `wamid.g${++seq}`, from: OWNER, ...message }] } }] }] });
  const sig = "sha256=" + crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
  const r = await fetch(`${base}/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sig }, body: raw });
  assert.equal(r.status, 200);
  for (let i = 0; i < 40 && !sent.length; i++) await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(sent.length, 1, `one reply, got ${JSON.stringify(sent)}`);
  return sent[0];
}
const text = (t) => owner({ type: "text", text: { body: t } });
const tapButton = (title) => owner({ type: "interactive", interactive: { type: "button_reply", button_reply: { id: title, title } } });
const tapRow = (id, title) => owner({ type: "interactive", interactive: { type: "list_reply", list_reply: { id, title } } });
const body = (m) => m.interactive?.body?.text || m.text?.body || "";
const buttons = (m) => (m.interactive?.type === "button" ? m.interactive.action.buttons.map((b) => b.reply.title) : []);
const rows = (m) => (m.interactive?.type === "list" ? m.interactive.action.sections[0].rows : []);

try {
  // Photo with no caption: the bot asks which section, as a tap menu in Meta's list format.
  let m = await owner({ type: "image", image: { id: "media1" } });
  assert.equal(m.interactive?.type, "list");
  assert.match(body(m), /Got it!.*section/s);
  assert.deepEqual(rows(m).map((r) => r.id), ["Clothes", "Shoes", "Perfume", "Accessory"]);
  for (const r of rows(m)) assert.ok(r.title.length <= 24);
  assert.ok(m.interactive.action.button.length <= 20);
  ok("a photo with no caption gets a tap-to-choose section menu");

  m = await tapRow("Clothes", "👕 Clothes");
  assert.match(body(m), /What's it called/);
  ok("tapping a section moves on to the name");

  m = await text("Prince Denim Jacket");
  assert.match(body(m), /What's the price/);
  ok("a name that looks like a typo of 'price' is still taken as the name");

  m = await text("two thousand");
  assert.match(body(m), /didn't get that.*2499/s);
  m = await text("2,499");
  assert.match(body(m), /Which sizes/);
  assert.deepEqual(buttons(m), ["Free size"]);
  ok("a price that isn't a number is asked again; a plain number is accepted");

  m = await text("m l xl");
  assert.match(body(m), /how it will look/);
  assert.match(body(m), /Prince Denim Jacket/);
  assert.match(body(m), /₹2,499/);
  assert.match(body(m), /M · L · XL/);
  assert.deepEqual(buttons(m), ["✅ Post it", "✏️ Change", "❌ Cancel"]);
  ok("once nothing is missing, the owner sees a short preview with Post it / Change / Cancel");

  m = await tapButton("✏️ Change");
  assert.deepEqual(rows(m).map((r) => r.id), ["Name", "Price", "Quantity", "Size", "Section", "Brand", "MRP"]);
  assert.equal(rows(m).find((r) => r.id === "Price").description, "₹2,499");
  m = await tapRow("Quantity", "📦 Quantity");
  assert.match(body(m), /How many pieces/);
  m = await tapButton("3");
  assert.match(body(m), /Updated.*3 pieces/s);
  ok("Change opens a menu of fields with their current values; picking one asks just that");

  m = await tapButton("✅ Post it");
  assert.match(body(m), /live on your website/i);
  const live = (await (await fetch(`${base}/api/products`)).json()).find((p) => p.name === "Prince Denim Jacket");
  assert.ok(live, "the product is on the website");
  assert.equal(live.price, 2499);
  assert.equal(live.quantity, 3);
  assert.equal(live.sizes, "M · L · XL");
  assert.equal(live.category, "Clothing");
  assert.ok(live.image, "with its photo");
  ok("Post it puts it on the website with everything the owner answered");

  // A photo with a full caption needs one tap.
  m = await owner({ type: "image", image: { id: "media2", caption: "Zara denim jacket 1899 M L" } });
  assert.match(body(m), /how it will look/);
  m = await tapButton("✅ Post it");
  assert.match(body(m), /live on your website/i);
  ok("a photo with a full caption goes live in one tap");

  // Today's whole stock at once: 3 photos arrive as separate webhooks; the bot answers ONCE.
  sent.length = 0;
  const album = [
    { id: "media3", caption: "" },
    { id: "media4", caption: "Dior Sauvage perfume 3200" },
    { id: "media5", caption: "jacket 2499 m l" },
  ];
  for (const p of album) {
    const raw = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: `wamid.g${++seq}`, from: OWNER, type: "image", image: { id: p.id, caption: p.caption } }] } }] }] });
    const sig = "sha256=" + crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
    await fetch(`${base}/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sig }, body: raw });
    await new Promise((r) => setTimeout(r, 120));
  }
  for (let i = 0; i < 60 && !sent.length; i++) await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(sent.length, 1, `one reply for the whole album, got ${sent.length}`);
  m = sent[0];
  assert.match(body(m), /Got 3 photos\. 2 ready, 1 needs/);
  assert.match(body(m), /Photo 1 of 3/);
  assert.equal(m.interactive?.header?.type, "image", "the question shows the photo it's about");
  assert.match(m.interactive.header.image.link, /^https:\/\/shop\.example\/uploads\//);
  assert.deepEqual(buttons(m), ["⏭️ Skip", "🗂️ Wrong section"]);
  ok("photos sent together get one reply, asking about the first that needs something, with its photo");

  m = await text("Casio watch 1800 x2");
  assert.match(body(m), /3 ready to post/);
  assert.match(body(m), /Casio watch · ₹1,800 · ×2/i);
  assert.match(body(m), /Jacket · ₹2,499 · M · L/);
  assert.deepEqual(buttons(m), ["✅ Post all", "👀 Check each", "❌ Cancel all"]);
  ok("one reply per photo fills it in; then a summary with Post all / Check each");

  m = await tapButton("✅ Post all");
  assert.match(body(m), /All 3 are live/);
  const names = (await (await fetch(`${base}/api/products`)).json()).map((p) => p.name);
  for (const x of ["casio watch", "dior sauvage", "jacket"]) assert.ok(names.some((y) => y.toLowerCase().startsWith(x)), `${x} is live`);
  ok("Post all puts the whole batch on the website at once");

  // A wrong selection left unposted, then new photos later: the bot asks before mixing them.
  m = await owner({ type: "image", image: { id: "media6", caption: "wrong one" } });
  await new Promise((r) => setTimeout(r, 1700)); // the owner moved on (and maybe cleared the chat)
  sent.length = 0;
  for (const id of ["media7", "media8"]) {
    const raw = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: `wamid.g${++seq}`, from: OWNER, type: "image", image: { id, caption: "" } }] } }] }] });
    const sig = "sha256=" + crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
    await fetch(`${base}/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sig }, body: raw });
  }
  for (let i = 0; i < 60 && !sent.length; i++) await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 300));
  m = sent[0];
  assert.match(body(m), /2 new photos.*1 from before/s);
  assert.deepEqual(buttons(m), ["🆕 Just the new", "➕ Keep both"]);
  ok("new photos while an old one waits: the bot asks before mixing them");

  m = await tapButton("🆕 Just the new");
  assert.match(body(m), /Dropped the 1 old one.*Photo 1 of 2/s);
  ok("'Just the new' drops the old one and goes through only the new photos");

  m = await text("clear");
  assert.match(body(m), /Cleared all 2 photos/);
  m = await text("done");
  assert.match(body(m), /Nothing is waiting/);
  ok("'clear' drops everything waiting");

  console.log(`\nall ${n} checks passed`);
} catch (e) {
  console.error(e); console.error("--- server log ---\n" + log); process.exitCode = 1;
} finally {
  srv.kill(); graph.close(); fs.rmSync(dir, { recursive: true, force: true });
}
