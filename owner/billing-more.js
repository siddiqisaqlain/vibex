// Settings, staff, item editor, labels, shared ledgers and bill scanning for the portal.
(() => {
  const { api, esc, inr, toast } = window.VX;
  const $ = (id) => document.getElementById(id);

  // ---- Add or edit an item ----
  const CATS = ["Clothing", "Footwear", "Fragrances", "Accessories"];
  function itemForm(p, newName = "") {
    const box = $("itemBox");
    const f = (k, label, type = "text") => `<label class="sub">${label}<input id="it-${k}" type="${type}" value="${esc(p?.[k] ?? "")}"></label>`;
    box.innerHTML = `<details class="form" open><summary>${p ? `Edit #${esc(p.code)}` : "New item"}</summary><div>
      <div id="it-photos"></div>
      <div class="row2">${f("name", "Name")}<label class="sub">Section<select id="it-category">${CATS.map((c) => `<option ${(p?.category || "Clothing") === c ? "selected" : ""}>${c}</option>`).join("")}</select></label></div>
      <div class="row3">${f("mrp", "Actual price (MRP)", "number")}${f("price", "Selling price ₹", "number")}${f("cost", "Purchase price ₹", "number")}</div>
      <p class="sub" id="it-offer" style="margin:4px 0 0"></p>
      <div class="row3">${f("barcode", "Barcode")}<label class="sub">Sizes<input id="it-sizes" value="${esc(p?.sizePrices ? Object.entries(p.sizePrices).map(([s, v]) => `${s} ${v}`).join(" · ") : p?.sizes ?? "")}" placeholder="50ml 2999 100ml 4999"></label>${f("reorderAt", "Alert when stock at", "number")}</div>
      <p class="sub" style="margin:4px 0 0">Perfume sizes: type <b>100ml</b> for one size, or <b>50ml 2999 100ml 4999</b> for a price on each. Those prices replace the selling price above.</p>
      <div id="it-sizeRows"></div>
      <div class="row3">${f("hsn", "HSN code")}${f("gstRate", "GST % (blank = default)", "number")}${p ? "<div></div>" : f("quantity", "Opening stock", "number")}</div>
      ${p ? `<label class="sub" style="display:block;margin-top:8px"><input type="checkbox" id="it-onWebsite" ${p.hidden ? "" : "checked"} ${p.image ? "" : "disabled"}> Show on website<span id="it-webNote">${p.image ? "" : " (add a photo first)"}</span></label>
      <label class="sub" style="display:block;margin-top:4px"><input type="checkbox" id="it-featured" ${p.featured ? "checked" : ""}> Feature on home page (beside the video, up to 6)</label>` : ""}
      <button class="big" id="itSave">Save</button><div class="err" id="itErr"></div></div></details>`;
    if (newName) $("it-name").value = newName;
    // Photos save the moment they're added, so typing in the form is never lost. A new item has
    // nowhere to save them yet: they wait here and go up right after Save.
    let waiting = [];
    if (p) photoEditor($("it-photos"), p, (next) => {
      const box = $("it-onWebsite");
      if (!box) return;
      box.disabled = !next.image; box.checked = !next.hidden;
      $("it-webNote").textContent = next.image ? "" : " (add a photo first)";
    });
    else {
      $("it-photos").innerHTML = `<input type="file" id="phFile" accept="image/*,.heic,.heif" multiple hidden><button class="tbtn photoAdd" id="phAdd">Add photos</button><p class="sub" id="phBusy"></p>`;
      $("phAdd").onclick = () => $("phFile").click();
      $("phFile").onchange = (e) => {
        waiting = [...e.target.files].slice(0, MAX_PHOTOS);
        $("phBusy").textContent = waiting.length ? `${waiting.length === 1 ? "1 photo" : `${waiting.length} photos`} ready. They go up when you press Save.` : "";
      };
    }
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
    // What the website will show, redrawn as the prices change. Same sum as offPct in shop.js.
    const drawOffer = () => {
      const mrp = Number($("it-mrp").value), price = Number($("it-price").value), line = $("it-offer");
      const priced = ($("it-sizes").value.match(/\d\s?mls?\s*[-:=@]?\s*(?:₹|rs\.?)?\s*\d{2}/gi) || []).length > 1; // "50ml 2999 100ml 4999"
      if (!mrp) line.textContent = "No offer on the website. Enter the actual price to show one.";
      else if (priced) line.textContent = "No offer badge: this item has a different price for each size.";
      else if (!price || mrp <= price) line.textContent = "No offer on the website: the actual price must be higher than the selling price.";
      else line.innerHTML = `Website shows: <b>${Math.round((1 - price / mrp) * 100)}% OFF</b>, ₹${price.toLocaleString("en-IN")} <s>₹${mrp.toLocaleString("en-IN")}</s>`;
    };
    for (const k of ["mrp", "price", "sizes"]) $(`it-${k}`).addEventListener("input", drawOffer);
    drawOffer();
    $("itSave").onclick = async () => {
      const b = {};
      for (const k of ["name", "category", "price", "cost", "mrp", "barcode", "sizes", "reorderAt", "hsn", "gstRate", "quantity"]) if ($(`it-${k}`)) b[k] = $(`it-${k}`).value;
      if ($("it-onWebsite") && !$("it-onWebsite").disabled) b.onWebsite = $("it-onWebsite").checked;
      if ($("it-featured")) b.featured = $("it-featured").checked;
      const boxes = [...document.querySelectorAll("[data-ss]")];
      if (boxes.length) b.sizeStock = boxes.some((i) => i.value !== "") ? Object.fromEntries(boxes.map((i) => [i.dataset.ss, i.value])) : {};
      try {
        const r = await api(p ? `/api/billing/items/${p.id}` : "/api/billing/items", { method: "POST", body: JSON.stringify(b) });
        window.VX.closeDrawer(); toast(p ? "Saved." : "Added."); await window.VX.reload();
        if (!p) itemPhotos(r.product, "", waiting);
      } catch (e) { $("itErr").textContent = e.message; }
    };
  }
  window.VX.itemForm = itemForm;

  // ---- Photos and the website, for one item ----
  const MAX_PHOTOS = 6;
  // A phone photo can be 10 MB. 1600px is plenty for the shop and keeps the disk and the page light.
  const toJpeg = (blob) => new Promise((done, fail) => {
    const url = URL.createObjectURL(blob), img = new Image();
    img.onload = () => {
      const s = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      const g = c.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); // see-through PNGs would turn black
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      done(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); fail(new Error("unreadable")); };
    img.src = url;
  });
  // iPhone photos are HEIC. Safari reads them, Chrome can't, so Chrome borrows a decoder (1.3 MB, only fetched here).
  let heicLib;
  const loadHeic = () => heicLib ||= new Promise((done, fail) => {
    const tag = document.createElement("script");
    tag.src = "/billing-heic.js"; tag.onload = done;
    tag.onerror = () => { heicLib = null; fail(new Error("no decoder")); };
    document.head.append(tag);
  });
  const isHeic = (f) => /hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name);
  async function shrink(file) {
    try { return await toJpeg(file); } catch { /* not a type this browser can open */ }
    try {
      if (isHeic(file)) {
        await loadHeic();
        const out = await window.heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
        return await toJpeg(Array.isArray(out) ? out[0] : out);
      }
    } catch { /* same message below */ }
    throw new Error(`${file.name} couldn't be read. Use a JPG, PNG, WebP or iPhone photo.`);
  }
  const photoCall = (p, body) => api(`/api/billing/items/${p.id}/photos`, { method: "POST", body: JSON.stringify(body) });

  // The photos of one item, used in the Photos panel and in the Edit form. Every change saves at once.
  function photoEditor(host, item, onChange, first) {
    let cur = item, msg = "", bad = false, swapping = null;
    const list = () => [cur.image, ...(cur.images || [])].filter(Boolean);
    const q = (s) => host.querySelector(s);
    const after = async (next, text) => { cur = next; msg = text || ""; bad = false; draw(); onChange?.(cur); await window.VX.reload(); };
    async function upload(files, replace) {
      const room = replace ? 1 : MAX_PHOTOS - list().length;
      const take = files.slice(0, room), left = files.length - take.length;
      let added = 0, failed = "";
      q("#phAdd").disabled = true; host.querySelectorAll(".photoBtns button").forEach((b) => (b.disabled = true));
      for (const f of take) {
        q("#phBusy").textContent = take.length > 1 ? `Adding photo ${added + 1} of ${take.length}…` : "Adding photo…";
        try { cur = (await photoCall(cur, { add: await shrink(f), ...(replace ? { replace } : {}) })).product; added++; }
        catch (e) { failed = e.message; }
      }
      const note = [failed, left > 0 ? `${left} left out: an item can have ${MAX_PHOTOS} photos at most.` : ""].filter(Boolean).join(" ");
      msg = note || (added ? (replace ? "Photo changed." : added > 1 ? `${added} photos added.` : "Photo added.") : ""); bad = !!note;
      draw(); onChange?.(cur);
      if (note) toast(note, { bad: true });
      await window.VX.reload();
    }
    function draw() {
      const all = list(), full = all.length >= MAX_PHOTOS;
      host.innerHTML = `${all.length ? `<div class="photoGrid">${all.map((u, i) => `<div class="photoTile"><img src="${esc(u)}" alt="Photo ${i + 1} of ${esc(cur.name)}">
          ${i ? "" : `<span class="pill photoMain">Main photo</span>`}
          <div class="photoBtns"><button class="tbtn" data-swap="${esc(u)}">Change</button>${i ? `<button class="tbtn" data-main="${esc(u)}">Make main</button>` : ""}<button class="tbtn danger" data-del="${esc(u)}">Remove</button></div></div>`).join("")}</div>` : `<p class="sub">No photos yet.</p>`}
        <input type="file" id="phFile" accept="image/*,.heic,.heif" multiple hidden>
        <input type="file" id="phOne" accept="image/*,.heic,.heif" hidden>
        <button class="tbtn photoAdd" id="phAdd" ${full ? "disabled" : ""}>${full ? `${MAX_PHOTOS} photos is the most an item can have` : all.length ? "Add more photos" : "Add photos"}</button>
        <p class="sub ${bad ? "photoBad" : ""}" id="phBusy" role="status">${esc(msg)}</p>`;
      q("#phAdd").onclick = () => q("#phFile").click();
      q("#phFile").onchange = (e) => upload([...e.target.files]);
      q("#phOne").onchange = (e) => { if (e.target.files[0]) upload([e.target.files[0]], swapping); };
      host.querySelectorAll("[data-swap]").forEach((b) => (b.onclick = () => { swapping = b.dataset.swap; q("#phOne").click(); }));
      host.querySelectorAll("[data-main]").forEach((b) => (b.onclick = async () => {
        try { await after((await photoCall(cur, { main: b.dataset.main })).product, "Main photo changed."); } catch (e) { toast(e.message, { bad: true }); }
      }));
      host.querySelectorAll("[data-del]").forEach((b) => window.VX.twoTap(b, all.length === 1 && !cur.hidden ? "Remove and take off website" : "Tap again", async () => {
        const r = await photoCall(cur, { remove: b.dataset.del });
        await after(r.product, r.tookOff ? "Photo removed. The item is off the website until it has a photo." : "Photo removed.");
      }));
    }
    draw();
    if (first?.length) upload(first);
  }

  // Puts an item on the website or takes it off. Returns the saved item, or null with the reason shown.
  async function setOnWebsite(p, on, again) {
    try {
      const r = await api(`/api/billing/items/${p.id}`, { method: "POST", body: JSON.stringify({ onWebsite: on }) });
      const left = window.VX.stockOf(r.product);
      toast(on ? (left > 0 ? "On the website now." : "On the website, shown as sold out until you add stock.") : "Off the website. It's still in your stock for billing.", { action: "Undo", run: async () => { await setOnWebsite(r.product, !on, again); } });
      await window.VX.reload();
      again?.(r.product);
      return r.product;
    } catch (e) { toast(e.message, { bad: true }); return null; }
  }

  function itemPhotos(p, note = "", first) {
    const box = window.VX.drawer(p.name, `<p class="sub" id="phState"></p>
      ${note ? `<p class="sub" id="phNote"><b>${esc(note)}</b></p>` : ""}
      <div id="phHost"></div>
      <button class="big" id="phWeb"></button>`);
    const q = (s) => box.querySelector(s);
    let cur = p;
    const paint = (next) => {
      cur = next;
      q("#phState").textContent = `#${cur.code} · ${cur.hidden ? "Not on website" : "On the website"}`;
      q("#phWeb").textContent = cur.hidden ? "Put on website" : "Take off website";
      if (cur.image) q("#phNote")?.remove();
    };
    paint(p);
    photoEditor(q("#phHost"), p, paint, first);
    q("#phWeb").onclick = () => {
      if (cur.hidden && !cur.image) return itemPhotos(cur, "Add a photo first, then put it on the website.");
      return setOnWebsite(cur, !!cur.hidden, itemPhotos);
    };
  }
  window.VX.itemPhotos = itemPhotos;
  window.VX.setOnWebsite = setOnWebsite;

  // ---- Linking website items to imported stock ----
  const words = (s) => new Set(String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length > 2));
  const overlap = (a, b) => { const A = words(a), B = words(b); let n = 0; for (const w of A) if (B.has(w)) n++; return n; };
  window.VX.linkPanel = async () => {
    const items = await api("/api/billing/products");
    const web = items.filter((p) => !p.hidden && !p.importKey), stock = items.filter((p) => p.hidden);
    const linked = items.filter((p) => p.importKey && !/^mbb/.test(p.id));
    if (!web.length && !linked.length) return toast("Nothing to link yet.");
    if (!stock.length && !linked.length) return toast("Import the stock list first. There's nothing to link to yet.");
    const options = (p) => {
      const ranked = stock.map((s) => ({ s, n: overlap(p.name, s.name) })).sort((a, b) => b.n - a.n || a.s.name.localeCompare(b.s.name));
      return ranked.map(({ s, n }) => `<option value="${esc(s.id)}">${n ? "★ " : ""}${esc(s.name)} (${s.quantity} pcs, ₹${esc(s.price ?? "-")})</option>`).join("");
    };
    const thumb = (p) => `<td><div class="thumb" style="${p.image ? `background-image:url('${esc(p.image)}')` : ""}"></div></td>`;
    const box = window.VX.drawer("Link website items", `${web.length && stock.length ? `<p class="sub">Pick the same item from his stock. The website keeps its photo and price, and takes the real stock count and barcode. ★ means a similar name, so check each one before linking.</p>
      <div class="scroll"><table><tbody>${web.map((p) => `<tr>${thumb(p)}<td><div class="name" style="white-space:normal">${esc(p.name)}</div><div class="sub">${inr(p.price)} · ${p.quantity ?? 1} on website</div></td><td><select data-lk="${esc(p.id)}"><option value="">Choose stock item…</option>${options(p)}</select></td><td class="n"><button class="tbtn" data-lkgo="${esc(p.id)}">Link</button></td></tr>`).join("")}</tbody></table></div>` : ""}
      ${linked.length ? `<h4 class="linkHead">Linked items</h4><p class="sub">Unlink splits one back into two. The stock item keeps today's count and goes off the website. The website item gets its old count back and is marked Count this, so check it.</p>
      <div class="scroll"><table><tbody>${linked.map((p) => `<tr>${thumb(p)}<td><div class="name" style="white-space:normal">${esc(p.name)}</div><div class="sub">${p.quantity ?? 0} in stock${p.barcode ? ` · ${esc(p.barcode)}` : ""}</div></td><td class="n"><button class="tbtn danger" data-unlink="${esc(p.id)}">Unlink</button></td></tr>`).join("")}</tbody></table></div>` : ""}`, { wide: true });
    box.querySelectorAll("[data-unlink]").forEach((b) => window.VX.twoTap(b, "Tap again to unlink", async () => {
      await api("/api/billing/unlink", { method: "POST", body: JSON.stringify({ id: b.dataset.unlink }) });
      toast("Unlinked. Check the website item's count.");
      await window.VX.reload(); window.VX.linkPanel();
    }));
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
        <label class="sub">GSTIN<input id="sGst" value="${esc(s.gstin)}" placeholder="Blank until registered"></label>
        <p class="sub">Adding a GSTIN turns on tax invoices for new bills straight away. Check the rates and HSN codes with a CA first.</p>
        <button class="big" id="sSave">Save</button><div class="err" id="sErr"></div></div>
      <div class="form"><b>Staff logins</b>
        <p class="sub">Staff can make bills and see stock. They can't see cost prices or profit, cancel bills, or open the other tabs.</p>
        <div class="row2"><input id="stName" placeholder="Name"><input id="stPin" type="password" inputmode="numeric" placeholder="PIN, 4 to 6 digits" autocomplete="new-password"></div>
        <button class="big" id="stAdd">Add staff</button><div class="err" id="stErr"></div>
        <table style="margin-top:8px"><tbody>${people.length ? people.map((p) => `<tr><td>${esc(p.name)}</td><td class="n"><button class="tbtn danger" data-strm="${p.id}">Remove</button></td></tr>`).join("") : `<tr><td class="empty">No staff yet.</td></tr>`}</tbody></table></div>
      <div class="form"><b>Printing on this device</b>
        <div class="row2"><label class="sub">Paper<select id="prSize"><option value="a4">A4</option><option value="80">3-inch shop printer</option></select></label>
        <label class="sub checkLine"><input type="checkbox" id="prAuto"> Print each bill as soon as it's saved</label></div></div>
      <div class="form"><b>Backup</b>
        <p class="sub">Download everything: items, bills, parties, payments, purchases, expenses, returns and orders. Keep a copy somewhere safe, away from the server.</p>
        <button class="tbtn" id="backupGo">Download backup</button></div>
      <div class="form onlyKeysBlock"><b>Keyboard shortcuts</b>
        <table class="mini"><tbody><tr><td><kbd>F2</kbd></td><td>New bill</td></tr><tr><td><kbd>Ctrl K</kbd></td><td>Search everything</td></tr><tr><td><kbd>↑ ↓</kbd> <kbd>Enter</kbd></td><td>Pick an item while billing</td></tr><tr><td><kbd>Ctrl Enter</kbd></td><td>Create bill</td></tr><tr><td><kbd>Esc</kbd></td><td>Close a panel</td></tr></tbody></table></div>`;
    const store = window.VX.store;
    $("prSize").value = store.get("vx-print-size") || "a4";
    $("prAuto").checked = store.get("vx-print-auto") === "1";
    $("prSize").onchange = () => { store.set("vx-print-size", $("prSize").value); toast("Saved on this device."); };
    $("prAuto").onchange = () => { store.set("vx-print-auto", $("prAuto").checked ? "1" : "0"); toast("Saved on this device."); };
    $("backupGo").onclick = () => window.VX.download("/api/billing/backup", `vibex-backup-${window.VX.today()}.json`).catch((e) => toast(e.message, { bad: true }));
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
    // People you'd actually take this payment from, whoever owes the most first.
    const who = parties.filter((p) => p.type === (dir === "in" ? "customer" : "supplier")).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
    const label = (p) => `${esc(p.name)}${p.balance ? ` (${p.balance > 0 ? "owes" : "you owe"} ${inr(Math.abs(p.balance))})` : ""}`;
    const dayFmt = (d) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    $("tab-payments").innerHTML = `
      <details class="form"><summary>Create Payment ${dir === "in" ? "In" : "Out"}</summary>
        <div class="row2"><select id="pyParty"><option value="">Party…</option>${who.map((p) => `<option value="${p.id}">${label(p)}</option>`).join("")}</select><input id="pyAmt" type="number" min="1" placeholder="Amount ₹"></div>
        <div class="row2"><input id="pyDay" type="date" value="${today}" max="${today}"><select id="pyMode" aria-label="Mode"><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="bank">Bank</option></select></div>
        <input id="pyNote" placeholder="Note (optional)" style="margin-top:8px">
        <button class="big" id="pySave">Save</button><div class="err" id="pyErr"></div></details>
      <div class="scroll"><table><thead><tr><th>Date</th><th>Payment Number</th><th>Party Name</th><th>Mode</th><th class="n">Amount</th><th></th></tr></thead><tbody>
      ${shown.length ? shown.map((p) => `<tr class="${p.status === "cancelled" ? "cancelled" : ""}"><td>${dayFmt(p.day)}</td><td><b>${esc(p.number)}</b></td><td>${esc(names.get(p.partyId) || "")}</td><td>${esc(p.mode)}</td><td class="n"><b>${inr(p.amount)}</b></td><td class="n">${p.status === "cancelled" ? `<span class="sub">Cancelled</span>` : `<button class="tbtn danger" data-pcx="${p.id}">Cancel</button>`}</td></tr>`).join("") : `<tr><td colspan="6" class="empty">No payments yet.</td></tr>`}
      </tbody></table></div>`;
    $("pyParty").onchange = () => { const p = who.find((x) => x.id === $("pyParty").value); if (p?.balance) $("pyAmt").value = Math.abs(p.balance); };
    $("pySave").onclick = async () => {
      try { await api("/api/billing/payments", { method: "POST", body: JSON.stringify({ direction: dir, partyId: $("pyParty").value, amount: $("pyAmt").value, day: $("pyDay").value, mode: $("pyMode").value, note: $("pyNote").value }) }); toast("Saved."); payments(); }
      catch (e) { $("pyErr").textContent = e.message; }
    };
    document.querySelectorAll("[data-pcx]").forEach((b) => {
      window.VX.twoTap(b, "Tap again to cancel", async () => { await api(`/api/billing/payments/${b.dataset.pcx}/cancel`, { method: "POST", body: "{}" }); toast("Cancelled."); await window.VX.reload(); payments(); });
    });
  }

  // ---- Online Orders: the website's orders, with the same confirm and cancel as WhatsApp ----
  let orderView = "check";
  async function orders() {
    const list = await api("/api/billing/orders");
    const STATUS = { awaiting_payment: ["Awaiting payment", "low"], paid: ["Check payment", "low"], confirmed: ["Confirmed", ""], lapsed: ["Lapsed: back on sale", "out"], cancelled: ["Cancelled", "out"] };
    const waiting = list.filter((o) => o.status === "paid");
    const shown = (orderView === "check" ? waiting : list).slice().sort((a, b) => (a.status === "paid") === (b.status === "paid") ? 0 : a.status === "paid" ? -1 : 1);
    const left = (t) => { const ms = t - Date.now(), h = Math.floor(ms / 36e5), m = Math.max(0, Math.floor((ms % 36e5) / 6e4)); return ms <= 0 ? "Piece about to go back on sale" : `Piece held for ${h ? `${h}h ` : ""}${m}m more`; };
    const wa = (o) => { const n = String(o.phone || "").replace(/\D/g, "").slice(-10); return n.length === 10 ? `https://wa.me/91${n}?text=${encodeURIComponent(`Hi ${o.name}, this is Vibe X about your order ${o.code}.`)}` : ""; };
    $("tab-orders").innerHTML = `
      <div class="chips"><button class="chip ${orderView === "check" ? "on" : ""}" data-ov="check">To check ${waiting.length}</button><button class="chip ${orderView === "all" ? "on" : ""}" data-ov="all">All ${list.length}</button></div>
      <div class="scroll"><table><thead><tr><th>Date</th><th>Order</th><th>Party Name</th><th>Item</th><th class="n">Amount</th><th>Status</th><th></th></tr></thead><tbody>
      ${shown.length ? shown.map((o) => { const s = STATUS[o.status] || [o.status, ""]; return `<tr><td>${new Date(o.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</td><td><b>${esc(o.code)}</b></td><td>${esc(o.name)}<div class="sub">${esc(o.phone)}</div></td><td>${esc(o.productName)}</td><td class="n"><b>${inr(o.amount)}</b></td><td><span class="pill ${s[1]}">${s[0]}</span>${o.utr ? `<div class="sub">Ref ${esc(o.utr)}</div>` : ""}${o.lapsesAt ? `<div class="sub">${left(o.lapsesAt)}</div>` : ""}</td>
        <td class="n">${wa(o) ? `<a class="tbtn" href="${wa(o)}" target="_blank" rel="noopener">WhatsApp</a> ` : ""}${o.status === "paid" || o.status === "lapsed" ? `<button class="tbtn good" data-oa="confirm" data-oc="${esc(o.code)}">Confirm</button> ` : ""}${o.status !== "cancelled" ? `<button class="tbtn danger" data-oa="cancel" data-oc="${esc(o.code)}">Cancel</button>` : ""}</td></tr>`; }).join("") : `<tr><td colspan="7" class="empty">${orderView === "check" ? "No orders waiting. Nice." : "No website orders yet."}</td></tr>`}
      </tbody></table></div>`;
    document.querySelectorAll("[data-ov]").forEach((b) => (b.onclick = () => { orderView = b.dataset.ov; orders(); }));
    document.querySelectorAll("[data-oa]").forEach((b) => window.VX.twoTap(b, b.dataset.oa === "confirm" ? "Tap again: payment received" : "Tap again to cancel", async () => {
      await api(`/api/billing/orders/${b.dataset.oc}/${b.dataset.oa}`, { method: "POST", body: "{}" });
      toast("Done. Stock and bills updated."); await window.VX.reload(); orders();
    }));
  }
  Object.assign(window.VX.tabs, { payments, orders });

  // ---- Reading a supplier's bill photo into the purchase form ----
  window.VX.scanBill = async (file) => {
    const image = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(file); });
    return api("/api/billing/purchases/scan", { method: "POST", body: JSON.stringify({ image }) });
  };
})();
