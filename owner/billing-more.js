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
      <div class="row3">${f("barcode", "Barcode")}${f("sizes", "Sizes")}${f("reorderAt", "Alert when stock at", "number")}</div>
      <div class="row3">${f("hsn", "HSN code")}${f("gstRate", "GST % (blank = default)", "number")}${p ? "<div></div>" : f("quantity", "Opening stock", "number")}</div>
      <div class="row2" style="margin-top:8px"><button class="big" id="itSave" style="margin:0">Save</button><button class="tbtn" id="itClose">Close</button></div><div class="err" id="itErr"></div></div>`;
    box.scrollIntoView({ block: "center" });
    $("itClose").onclick = () => (box.innerHTML = "");
    $("itSave").onclick = async () => {
      const b = {};
      for (const k of ["name", "category", "price", "cost", "mrp", "barcode", "sizes", "reorderAt", "hsn", "gstRate", "quantity"]) if ($(`it-${k}`)) b[k] = $(`it-${k}`).value;
      try {
        await api(p ? `/api/billing/items/${p.id}` : "/api/billing/items", { method: "POST", body: JSON.stringify(b) });
        box.innerHTML = ""; toast(p ? "Saved." : "Added. It stays off the website until it has a photo."); await window.VX.reload();
      } catch (e) { $("itErr").textContent = e.message; }
    };
  }
  window.VX.itemForm = itemForm;

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

  // ---- Reading a supplier's bill photo into the purchase form ----
  window.VX.scanBill = async (file) => {
    const image = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(file); });
    return api("/api/billing/purchases/scan", { method: "POST", body: JSON.stringify({ image }) });
  };
})();
