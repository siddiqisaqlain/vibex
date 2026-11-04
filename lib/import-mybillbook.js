// Brings myBillBook's Stock Summary export into products.json.
// Preview is the default: plan() changes nothing and lists every problem. apply() writes it.
// New items arrive hidden: sellable at the counter straight away, on the website only once
// they have a photo. Running it twice adds nothing twice.
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const num = (s) => { const n = parseFloat(String(s ?? "").replace(/[^\d.\-]/g, "")); return Number.isFinite(n) ? n : null; };

function parseCsv(text) {
  const rows = []; let row = [], cell = "", quoted = false;
  const src = String(text).replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) { if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; }
    else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function guessCategory(name) {
  const n = norm(name);
  if (/\b(perfume|edp|edt|cologne|attar|\d+\s?ml)\b/.test(n)) return "Fragrances";
  if (/\b(shoes?|sneakers?|boots?|loafers?|sandals?|crocs|slides|brogues?|footwear)\b/.test(n)) return "Footwear";
  if (/\b(watch|watches|dial|belts?|bags?|wallets?|caps?|sunglass(es)?|backpack)\b/.test(n)) return "Accessories";
  return "Clothing";
}

function readRows(csv) {
  const rows = parseCsv(csv);
  const at = rows.findIndex((r) => r.some((c) => c.trim() === "Item Code") && r.some((c) => c.trim() === "Name"));
  if (at < 0) return { error: "This isn't a myBillBook Stock Summary file: no Name / Item Code columns." };
  const H = rows[at].map((c) => c.trim());
  const need = ["Name", "Item Code", "Purchase Price", "Selling Price", "Stock Quantity", "MRP"];
  const missing = need.filter((k) => !H.includes(k));
  if (missing.length) return { error: `Missing columns: ${missing.join(", ")}.` };
  const list = rows.slice(at + 1).filter((r) => r.length >= H.length && r[0].trim()).map((r) => {
    const g = (k) => r[H.indexOf(k)]?.trim() || "";
    return { name: g("Name").replace(/\s+/g, " "), barcode: /^\d+$/.test(g("Item Code")) ? g("Item Code") : "", cost: num(g("Purchase Price")), price: num(g("Selling Price")), qty: num(g("Stock Quantity")) ?? 0, mrp: num(g("MRP")), tag: g("Item Category Name") };
  });
  return { list };
}

// items = products.json now. Returns what would happen, and the finished list.
function plan(csv, items, { newCode, refreshStock = false } = {}) {
  const read = readRows(csv);
  if (read.error) return read;
  const out = items.map((p) => ({ ...p }));
  const report = { rows: read.list.length, added: 0, matched: 0, unchanged: 0, inStock: 0, needCount: [], noBarcode: [], badName: [], noPrice: [], sameName: [], highMrp: [] };
  const counts = {};
  for (const r of read.list) { const k = norm(r.name); counts[k] = (counts[k] || 0) + 1; }
  const seen = {};
  for (const r of read.list) {
    const k = norm(r.name);
    seen[k] = (seen[k] || 0) + 1;
    const key = r.barcode || `name:${k}#${seen[k]}`; // items without a code stay separate on a re-run
    const label = r.name;
    if (counts[k] > 1 && seen[k] === 1) report.sameName.push(`${label} (${counts[k]} items)`);
    const count = r.qty < 0;
    if (count) report.needCount.push(`${label}: ${r.qty}`);
    if (!r.barcode) report.noBarcode.push(label);
    const badName = /^\d+$/.test(r.name.replace(/\s/g, ""));
    if (badName) report.badName.push(label);
    if (!r.price) report.noPrice.push(label);
    if (r.mrp && r.price && r.mrp >= 8 * r.price) report.highMrp.push(`${label}: sells ₹${r.price}, MRP ₹${r.mrp}`);
    const qty = Math.max(0, Math.round(r.qty));
    if (qty > 0) report.inStock++;

    const prior = out.find((p) => p.importKey === key) || (r.barcode && out.find((p) => p.barcode === r.barcode));
    if (prior) {
      report.unchanged++;
      if (refreshStock) { prior.quantity = qty; prior.status = qty > 0 ? (prior.status === "sold" ? "available" : prior.status) : "sold"; }
      continue;
    }
    // Already on the website under the same name: keep its photo and price, add what's missing.
    const live = counts[k] === 1 && out.find((p) => !p.importKey && norm(p.name) === k);
    if (live) {
      Object.assign(live, { importKey: key, barcode: r.barcode || live.barcode || "", cost: r.cost ?? live.cost ?? null, mrp: live.mrp || r.mrp || null, quantity: qty, status: live.status === "hold" ? "hold" : qty > 0 ? "available" : "sold", ...(count ? { needsCount: true } : {}) });
      report.matched++;
      continue;
    }
    out.push({
      id: `mbb${require("crypto").randomBytes(6).toString("hex")}`, code: newCode(out), importKey: key, hidden: true,
      name: r.name, brand: "", category: guessCategory(r.name), subcategory: null, sizes: "", image: null, caption: "",
      barcode: r.barcode, cost: r.cost, price: r.price, mrp: r.mrp, quantity: qty, status: qty > 0 ? "available" : "sold",
      createdAt: new Date().toISOString(), ...(count ? { needsCount: true } : {}), ...(badName ? { needsName: true } : {}),
    });
    report.added++;
  }
  return { report, items: out };
}

module.exports = { parseCsv, plan, guessCategory, readRows };
