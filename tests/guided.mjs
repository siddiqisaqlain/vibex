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
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, ORDER_HOURS: "0-24", OWNER_KEY: "k", WA_TOKEN: "t", WA_PHONE_ID: "123", WA_APP_SECRET: SECRET,
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
  assert.deepEqual(rows(m).map((r) => r.id), ["Name", "Price", "Quantity", "Size", "Section", "Brand", "MRP", "Description"]);
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
  assert.match(body(m), /Are they all \*\w+\*\?/);
  assert.equal(buttons(m).length, 3);
  assert.equal(buttons(m)[1], "🔀 Mixed");
  for (const b of buttons(m)) assert.ok(b.length <= 20, b);
  ok("an unsure batch starts with one question for all photos: Are they all …? / Mixed / Something else");
  m = await tapButton("🔀 Mixed");
  assert.match(body(m), /check each one.*Photo 1 of 3/s);
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
  assert.match(body(m), /Dropped the 1 old one.*Are they all/s);
  m = await tapButton("🗂️ Something else");
  assert.deepEqual(rows(m).map((r) => r.id), ["All clothes", "All perfume", "All shoes", "All accessories", "Mixed"]);
  m = await tapRow("All accessories", "All accessories");
  assert.match(body(m), /All accessories.*Photo 1 of 2/s);
  const q = JSON.parse(fs.readFileSync(path.join(dir, "pending.json"), "utf8"));
  assert.ok(q.every((x) => x.listing.category === "Accessories" && x.sure && !x.groupAsk), "all set to Accessories");
  ok("'Something else' -> All accessories sets the section for every photo, then per-photo questions");
  ok("'Just the new' drops the old one and goes through only the new photos");

  m = await text("clear");
  assert.match(body(m), /Cleared all 2 photos/);
  m = await text("done");
  assert.match(body(m), /Nothing is waiting/);
  ok("'clear' drops everything waiting");

  // Perfume sizes in ml, each with its own price.
  const listed = async (name) => (await (await fetch(`${base}/api/products`)).json()).find((p) => p.name === name);
  m = await owner({ type: "image", image: { id: "media9", caption: "Gucci Flora 50ml 2999 100ml 4999 3 pcs" } });
  assert.match(body(m), /50 ml ₹2,999, 100 ml ₹4,999/);
  assert.deepEqual(buttons(m), ["✅ Post it", "✏️ Change", "❌ Cancel"]);
  m = await text("desc Soft floral in the pink bottle");
  assert.match(body(m), /Soft floral in the pink bottle/);
  m = await tapButton("✅ Post it");
  let g = await listed("Gucci Flora");
  assert.ok(g, "listed under its clean name");
  assert.equal(g.price, 2999);
  assert.deepEqual(g.options, [{ size: "50 ml", price: 2999 }, { size: "100 ml", price: 4999 }]);
  assert.equal(g.description, "Soft floral in the pink bottle");
  assert.equal(g.sizePrices, undefined, "the raw price map stays on the server");
  ok("a caption with ml prices lists one product with two priced sizes and its description");

  const order = (extra) => fetch(`${base}/api/orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId: g.id, name: "Asha", phone: "9876543210", delivery: "pickup", ...extra }) });
  let r = await order({});
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /choose a size/i);
  r = await order({ size: "75 ml" });
  assert.equal(r.status, 400, "a size the product doesn't have is refused");
  const o = await (await order({ size: "100 ml", price: 1 })).json();
  assert.equal(o.amount, 4999, "the size sets the price, not the browser");
  sent.length = 0;
  for (let i = 0; i < 40 && !sent.length; i++) await new Promise((r) => setTimeout(r, 50));
  assert.match(body(sent[0]) || sent[0].image?.caption || JSON.stringify(sent[0]), /Gucci Flora\*? · 100 ml/);
  m = await text(`confirm ${o.code}`);
  assert.match(body(m), /confirmed/);
  const bill = JSON.parse(fs.readFileSync(path.join(dir, "invoices.json"), "utf8")).at(-1);
  assert.equal(bill.lines[0].sizes, "100 ml");
  assert.equal(bill.lines[0].unit, 4999);
  ok("an order needs a real size; the amount, owner alert and bill all use that size");

  const code = g.code;
  m = await text(`sold ${code}`);
  assert.match(body(m), new RegExp(`sold ${code} 50ml\\*? or \\*?sold ${code} 100ml`));
  m = await text(`sold ${code} 50ml`);
  assert.match(body(m), /Sold 1 × “Gucci Flora” 50 ml/);
  assert.match(body(m), /₹2,999/);
  m = await text(`sold ${code} 30ml`);
  assert.match(body(m), /doesn't have 30 ml/);
  ok("selling a priced size on WhatsApp asks which one and bills that size's price");

  m = await text(`sizes ${code} 30ml 1999 50ml 2999`);
  assert.match(body(m), /30 ml ₹1,999, 50 ml ₹2,999/);
  assert.equal((await listed("Gucci Flora")).price, 1999);
  m = await text(`desc ${code} New words about this perfume`);
  assert.match(body(m), /Description updated/);
  assert.equal((await listed("Gucci Flora")).description, "New words about this perfume");
  ok("sizes and description can be changed on a live product by its code");

  m = await owner({ type: "image", image: { id: "media10", caption: "Dior Sauvage perfume 3200" } });
  assert.match(body(m), /Which bottle sizes/);
  assert.deepEqual(buttons(m), ["Skip"]);
  m = await text("100ml");
  assert.match(body(m), /📏 100 ml/);
  m = await tapButton("✏️ Change");
  m = await tapRow("Size", "📏 Size");
  m = await text("30 ml 50ml 100ml");
  assert.match(body(m), /📏 30 ml · 50 ml · 100 ml/);
  m = await tapButton("✅ Post it");
  assert.deepEqual((await listed("Dior Sauvage perfume")).options.map((x) => [x.size, x.price]), [["30 ml", 3200], ["50 ml", 3200], ["100 ml", 3200]]);
  assert.match((await listed("Dior Sauvage perfume")).description, /original fragrance/);
  m = await owner({ type: "image", image: { id: "media11", caption: "Bleu perfume 2100" } });
  m = await tapButton("Skip");
  assert.deepEqual(buttons(m), ["✅ Post it", "✏️ Change", "❌ Cancel"]);
  m = await tapButton("❌ Cancel");
  ok("a single perfume is asked for its ml sizes, can skip, and gets a plain description");

  console.log(`\nall ${n} checks passed`);
} catch (e) {
  console.error(e); console.error("--- server log ---\n" + log); process.exitCode = 1;
} finally {
  srv.kill(); graph.close(); fs.rmSync(dir, { recursive: true, force: true });
}
