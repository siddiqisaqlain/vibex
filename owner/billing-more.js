// Settings, staff, item editor, labels, shared ledgers and bill scanning for the portal.
(() => {
  const { api, esc, inr, toast } = window.VX;
  const $ = (id) => document.getElementById(id);

  // ---- Add or edit an item ----
  const CATS = ["Clothing", "Footwear", "Fragrances", "Accessories"];
  function itemForm(p) {
    const box = $("itemBox");
    const f = (k, label, type = "text") => `<label class="sub">${label}<input id="it-${k}" type="${type}" value="${esc(p?.[k] ?? "")}"></label>`;
    box.innerHTML = `<div class="form"><b>${p ? `Edit #${esc(p.code)}` : "New item"}</b>
      <div class="row2">${f("name", "Name")}<label class="sub">Section<select id="it-category">${CATS.map((c) => `<option ${(p?.category || "Clothing") === c ? "selected" : ""}>${c}</option>`).join("")}</select></label></div>
      <div class="row3">${f("price", "Selling price ₹", "number")}${f("cost", "Purchase price ₹", "number")}${f("mrp", "MRP ₹", "number")}</div>
      <div class="row3">${f("barcode", "Barcode")}<label class="sub">Sizes<input id="it-sizes" value="${esc(p?.sizePrices ? Object.entries(p.sizePrices).map(([s, v]) => `${s} ${v}`).join(" · ") : p?.sizes ?? "")}" placeholder="50ml 2999 100ml 4999"></label>${f("reorderAt", "Alert when stock at", "number")}</div>
      <p class="sub" style="margin:4px 0 0">Perfume sizes: type <b>100ml</b> for one size, or <b>50ml 2999 100ml 4999</b> for a price on each. Those prices replace the selling price above.</p>
      <div id="it-sizeRows"></div>
      <div class="row3">${f("hsn", "HSN code")}${f("gstRate", "GST % (blank = default)", "number")}${p ? "<div></div>" : f("quantity", "Opening stock", "number")}</div>
      ${p ? `<label class="sub" style="display:block;margin-top:8px"><input type="checkbox" id="it-onWebsite" ${p.hidden ? "" : "checked"} ${p.image ? "" : "disabled"}> Show on website${p.image ? "" : " (needs a photo: send it on WhatsApp with the code)"}</label>
      <label class="sub" style="display:block;margin-top:4px"><input type="checkbox" id="it-featured" ${p.featured ? "checked" : ""}> Feature on home page (beside the video, up to 6)</label>` : ""}
      <div class="row2" style="margin-top:8px"><button class="big" id="itSave" style="margin:0">Save</button><button class="tbtn" id="itClose">Close</button></div><div class="err" id="itErr"></div></div>`;
    box.scrollIntoView({ block: "center" });
    // A stock box for each size, redrawn as the Sizes field changes. Blank boxes keep one shared count.
    const typed = { ...(p?.sizeStock || {}) };
    const sizeNames = (t) => {
      const ml = [...String(t).matchAll(/(\d{1,4}(?:\.\d)?)\s?mls?\b/gi)].map((m) => `${m[1]} ml`);
      if (ml.length) return [...new Set(ml)];
      const words = String(t).split(/[\s,·/|]+/).filter(Boolean).map((s) => s.toUpperCase());
      return words.every((w) => /^(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|\d{2})$/.test(w)) ? [...new Set(words)] : [];
    };
    const drawSizes = () => {
      const names = sizeNames($("it-sizes").value);
      $("it-sizeRows").innerHTML = names.length > 1 ? `<p class="sub" style="margin:8px 0 0">Stock of each size (leave blank to share one count)</p><div class="row3">${names.map((s) => `<label class="sub">${esc(s)}<input type="number" min="0" data-ss="${esc(s)}" value="${esc(typed[s] ?? "")}"></label>`).join("")}</div>` : "";
      document.querySelectorAll("[data-ss]").forEach((i) => (i.oninput = () => (typed[i.dataset.ss] = i.value)));
    };
    $("it-sizes").oninput = drawSizes;
    drawSizes();
    $("itClose").onclick = () => (box.innerHTML = "");
    $("itSave").onclick = async () => {
      const b = {};
      for (const k of ["name", "category", "price", "cost", "mrp", "barcode", "sizes", "reorderAt", "hsn", "gstRate", "quantity"]) if ($(`it-${k}`)) b[k] = $(`it-${k}`).value;
      if ($("it-onWebsite") && !$("it-onWebsite").disabled) b.onWebsite = $("it-onWebsite").checked;
      if ($("it-featured")) b.featured = $("it-featured").checked;
      const boxes = [...document.querySelectorAll("[data-ss]")];
      if (boxes.length) b.sizeStock = boxes.some((i) => i.value !== "") ? Object.fromEntries(boxes.map((i) => [i.dataset.ss, i.value])) : {};
      try {
        await api(p ? `/api/billing/items/${p.id}` : "/api/billing/items", { method: "POST", body: JSON.stringify(b) });
        box.innerHTML = ""; toast(p ? "Saved." : "Added. It stays off the website until it has a photo."); await window.VX.reload();
      } catch (e) { $("itErr").textContent = e.message; }
    };
  }
  window.VX.itemForm = itemForm;

  // ---- Linking website items to imported stock ----
  const words = (s) => new Set(String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length > 2));
  const overlap = (a, b) => { const A = words(a), B = words(b); let n = 0; for (const w of A) if (B.has(w)) n++; return n; };
  window.VX.linkPanel = async () => {
    const items = await api("/api/billing/products");
    const web = items.filter((p) => !p.hidden && !p.importKey), stock = items.filter((p) => p.hidden);
    const box = $("itemBox");
    if (!web.length) { box.innerHTML = `<div class="form"><b>All website items are linked.</b></div>`; return; }
    if (!stock.length) { box.innerHTML = `<div class="form"><b>Import his stock first.</b><p class="sub">There are no imported items to link to yet.</p></div>`; return; }
    const options = (p) => {
      const ranked = stock.map((s) => ({ s, n: overlap(p.name, s.name) })).sort((a, b) => b.n - a.n || a.s.name.localeCompare(b.s.name));
      return ranked.map(({ s, n }) => `<option value="${esc(s.id)}">${n ? "★ " : ""}${esc(s.name)} (${s.quantity} pcs, ₹${esc(s.price ?? "-")})</option>`).join("");
    };
    box.innerHTML = `<div class="form"><b>Link website items</b><p class="sub">Pick the same item from his stock. The website keeps its photo and price, and takes the real stock count and barcode. ★ means a similar name. Check each one before linking: it can't be undone from here.</p>
      <div class="scroll"><table><tbody>${web.map((p) => `<tr><td><div class="thumb" style="${p.image ? `background-image:url('${esc(p.image)}')` : ""}"></div></td><td><div class="name" style="white-space:normal">${esc(p.name)}</div><div class="sub">${inr(p.price)} · ${p.quantity ?? 1} on website</div></td><td><select data-lk="${esc(p.id)}"><option value="">Choose stock item…</option>${options(p)}</select></td><td class="n"><button class="tbtn" data-lkgo="${esc(p.id)}">Link</button></td></tr>`).join("")}</tbody></table></div>
      <button class="tbtn" id="lkClose" style="margin-top:8px">Close</button></div>`;
    $("lkClose").onclick = () => (box.innerHTML = "");
    box.querySelectorAll("[data-lkgo]").forEach((b) => (b.onclick = async () => {
      const stockId = box.querySelector(`[data-lk="${b.dataset.lkgo}"]`).value;
      if (!stockId) return toast("Choose the stock item first.");
      try { await api("/api/billing/link", { method: "POST", body: JSON.stringify({ websiteId: b.dataset.lkgo, stockId }) }); toast("Linked. Counter and website now share one stock."); await window.VX.reload(); window.VX.linkPanel(); }
      catch (e) { toast(e.message); }
    }));
  };

  // ---- Barcode labels ----
  window.VX.printLabels = async (ids) => {
    if (!ids.length) return toast("Tick the items first.");
    const r = await api("/api/billing/barcodes", { method: "POST", body: JSON.stringify({ ids }) });
    if (r.done.length) await window.VX.reload();
    const n = Math.max(1, Math.min(200, Number($("lblCount").value) || 1));
    window.open(`/billing/labels?items=${ids.map((i) => `${i}:${n}`).join(",")}`, "_blank", "noopener");
  };

  // ---- Settings and staff ----
  async function settings() {
    const [s, people] = await Promise.all([api("/api/billing/settings"), api("/api/billing/staff")]);
    const THEMES = [["classic", "Classic"], ["navy", "Navy"], ["maroon", "Maroon"], ["forest", "Forest"]];
    $("tab-settings").innerHTML = `
      <div class="form"><b>Bills</b>
        <label class="sub">Line at the top<input id="sHeader" value="${esc(s.headerLine)}"></label>
        <label class="sub">Terms<input id="sTerms" value="${esc(s.terms)}"></label>
        <div class="row2"><label class="sub">Email<input id="sEmail" value="${esc(s.email)}"></label><label class="sub">YouTube<input id="sYt" value="${esc(s.youtube)}"></label></div>
        <div class="row2"><label class="sub">Theme<select id="sTheme">${THEMES.map(([v, l]) => `<option value="${v}" ${s.theme === v ? "selected" : ""}>${l}</option>`).join("")}</select></label><label class="sub">Logo ${s.logo ? "(set)" : "(none yet)"}<input type="file" id="sLogo" accept="image/png,image/jpeg,image/webp"></label></div>
        <label class="sub">GSTIN<input id="sGst" value="${esc(s.gstin)}" placeholder="Blank until he registers"></label>
        <p class="sub">Adding a GSTIN turns on tax invoices for new bills straight away. Check the rates and HSN codes with his CA first.</p>
        <button class="big" id="sSave">Save</button><div class="err" id="sErr"></div></div>
      <div class="form"><b>Staff logins</b>
        <p class="sub">Staff can make bills and see stock. They can't see cost prices or profit, cancel bills, or open the other tabs.</p>
        <div class="row2"><input id="stName" placeholder="Name"><input id="stPin" type="password" inputmode="numeric" placeholder="PIN, 4 to 6 digits" autocomplete="new-password"></div>
        <button class="big" id="stAdd">Add staff</button><div class="err" id="stErr"></div>
        <table style="margin-top:8px"><tbody>${people.length ? people.map((p) => `<tr><td>${esc(p.name)}</td><td class="n"><button class="tbtn danger" data-strm="${p.id}">Remove</button></td></tr>`).join("") : `<tr><td class="empty">No staff yet.</td></tr>`}</tbody></table></div>`;
    $("sSave").onclick = async () => {
      try {
        const file = $("sLogo").files[0];
        const logoData = file ? await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(file); }) : undefined;
        await api("/api/billing/settings", { method: "POST", body: JSON.stringify({ headerLine: $("sHeader").value, terms: $("sTerms").value, email: $("sEmail").value, youtube: $("sYt").value, theme: $("sTheme").value, gstin: $("sGst").value, logoData }) });
        toast("Saved."); settings();
      } catch (e) { $("sErr").textContent = e.message; }
    };
    $("stAdd").onclick = async () => {
      try { await api("/api/billing/staff", { method: "POST", body: JSON.stringify({ name: $("stName").value, pin: $("stPin").value }) }); toast("Added."); settings(); }
      catch (e) { $("stErr").textContent = e.message; }
    };
    document.querySelectorAll("[data-strm]").forEach((b) => (b.onclick = async () => { await api(`/api/billing/staff/${b.dataset.strm}/remove`, { method: "POST", body: "{}" }); toast("Removed. That login stops working now."); settings(); }));
  }
  window.VX.tabs.settings = settings;

  // ---- Payment In / Payment Out ----
  let dir = "in";
  async function payments(sub) {
    if (sub === "in" || sub === "out") dir = sub;
    const [list, parties] = await Promise.all([api("/api/billing/payments"), api("/api/billing/parties")]);
    const names = new Map(parties.map((p) => [p.id, p.name]));
    const shown = list.filter((p) => p.direction === dir);
    const dayFmt = (d) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    $("tab-payments").innerHTML = `
      <details class="form"><summary>Create Payment ${dir === "in" ? "In" : "Out"}</summary>
        <div class="row2"><select id="pyParty"><option value="">Party…</option>${parties.map((p) => `<option value="${p.id}">${esc(p.name)} (${inr(p.balance)})</option>`).join("")}</select><input id="pyAmt" type="number" min="1" placeholder="Amount ₹"></div>
        <div class="row2"><input id="pyDay" type="date" value="${today}" max="${today}"><select id="pyMode"><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="bank">Bank</option></select></div>
        <input id="pyNote" placeholder="Note (optional)" style="margin-top:8px">
        <button class="big" id="pySave">Save</button><div class="err" id="pyErr"></div></details>
      <div class="scroll"><table><thead><tr><th>Date</th><th>Payment Number</th><th>Party Name</th><th>Mode</th><th class="n">Amount</th><th></th></tr></thead><tbody>
      ${shown.length ? shown.map((p) => `<tr class="${p.status === "cancelled" ? "cancelled" : ""}"><td>${dayFmt(p.day)}</td><td><b>${esc(p.number)}</b></td><td>${esc(names.get(p.partyId) || "")}</td><td>${esc(p.mode)}</td><td class="n"><b>${inr(p.amount)}</b></td><td class="n">${p.status === "cancelled" ? `<span class="sub">Cancelled</span>` : `<button class="tbtn danger" data-pcx="${p.id}">Cancel</button>`}</td></tr>`).join("") : `<tr><td colspan="6" class="empty">No payments yet.</td></tr>`}
      </tbody></table></div>`;
    $("pySave").onclick = async () => {
      try { await api("/api/billing/payments", { method: "POST", body: JSON.stringify({ direction: dir, partyId: $("pyParty").value, amount: $("pyAmt").value, day: $("pyDay").value, mode: $("pyMode").value, note: $("pyNote").value }) }); toast("Saved."); payments(); }
      catch (e) { $("pyErr").textContent = e.message; }
    };
    document.querySelectorAll("[data-pcx]").forEach((b) => {
      const first = b.textContent;
      b.onclick = async () => {
        if (!b.classList.contains("sure")) { b.classList.add("sure"); b.textContent = "Tap again to cancel"; setTimeout(() => { b.classList.remove("sure"); b.textContent = first; }, 4000); return; }
        await api(`/api/billing/payments/${b.dataset.pcx}/cancel`, { method: "POST", body: "{}" }); toast("Cancelled."); payments();
      };
    });
  }

  // ---- Online Orders: the website's orders, with the same confirm and cancel as WhatsApp ----
  async function orders() {
    const list = await api("/api/billing/orders");
    const STATUS = { awaiting_payment: ["Awaiting payment", "low"], paid: ["Check payment", "low"], confirmed: ["Confirmed", ""], lapsed: ["Lapsed: back on sale", "out"], cancelled: ["Cancelled", "out"] };
    $("tab-orders").innerHTML = `<div class="scroll"><table><thead><tr><th>Date</th><th>Order</th><th>Party Name</th><th>Item</th><th class="n">Amount</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.length ? list.map((o) => { const s = STATUS[o.status] || [o.status, ""]; return `<tr><td>${new Date(o.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</td><td><b>${esc(o.code)}</b></td><td>${esc(o.name)}<div class="sub">${esc(o.phone)}</div></td><td>${esc(o.productName)}</td><td class="n"><b>${inr(o.amount)}</b></td><td><span class="pill ${s[1]}">${s[0]}</span>${o.utr ? `<div class="sub">Ref ${esc(o.utr)}</div>` : ""}</td>
        <td class="n">${o.status === "paid" || o.status === "lapsed" ? `<button class="tbtn" data-oa="confirm" data-oc="${esc(o.code)}">Confirm</button> ` : ""}${o.status !== "cancelled" ? `<button class="tbtn danger" data-oa="cancel" data-oc="${esc(o.code)}">Cancel</button>` : ""}</td></tr>`; }).join("") : `<tr><td colspan="7" class="empty">No website orders yet.</td></tr>`}
      </tbody></table></div>`;
    document.querySelectorAll("[data-oa]").forEach((b) => {
      const first = b.textContent;
      b.onclick = async () => {
        if (!b.classList.contains("sure")) { b.classList.add("sure"); b.textContent = "Tap again"; setTimeout(() => { b.classList.remove("sure"); b.textContent = first; }, 4000); return; }
        try { await api(`/api/billing/orders/${b.dataset.oc}/${b.dataset.oa}`, { method: "POST", body: "{}" }); toast("Done. Stock and bills updated."); }
        catch (e) { toast(e.message); }
        orders();
      };
    });
  }
  Object.assign(window.VX.tabs, { payments, orders });

  // ---- Reading a supplier's bill photo into the purchase form ----
  window.VX.scanBill = async (file) => {
    const image = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(file); });
    return api("/api/billing/purchases/scan", { method: "POST", body: JSON.stringify({ image }) });
  };
})();
