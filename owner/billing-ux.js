// Shared by every page of the portal: side panels, the search box, shortcuts and taking a payment.
(() => {
  const { api, esc, inr, toast, go } = window.VX;
  const $ = (id) => document.getElementById(id);
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const istDate = (t) => new Date(t).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

  // Two taps instead of a pop-up. The label says what the second tap will do.
  function twoTap(b, label, run) {
    const first = b.textContent;
    b.onclick = async (e) => {
      e?.stopPropagation();
      if (!b.classList.contains("sure")) { b.classList.add("sure"); b.textContent = label; setTimeout(() => { b.classList.remove("sure"); b.textContent = first; }, 4000); return; }
      b.disabled = true;
      try { await run(); } catch (err) { toast(err.message, { bad: true }); b.disabled = false; }
    };
  }

  // ---- Side panels. Every "Create…" form on every page opens as one. ----
  const openPanels = () => [...document.querySelectorAll("details.form[open]")];
  const paintVeil = () => $("veil").classList.toggle("hide", !openPanels().length);
  function closeDrawer() {
    openPanels().forEach((d) => (d.open = false));
    $("drawerHost").innerHTML = "";
    $("itemBox").innerHTML = "";
    paintVeil();
  }
  function drawer(title, html, opts = {}) {
    $("drawerHost").innerHTML = `<details class="form ${opts.wide ? "wide" : ""}" open><summary>${esc(title)}</summary><div>${html}</div></details>`;
    const d = $("drawerHost").firstElementChild;
    paintVeil();
    return d;
  }
  $("veil").onclick = closeDrawer;
  // A closed panel built only for the moment is thrown away, so the next one starts clean.
  document.addEventListener("toggle", (e) => {
    if (e.target.matches?.("details.form")) {
      paintVeil();
      if (e.target.open) { const first = e.target.querySelector("input:not([type=hidden]):not([type=radio]):not([type=file]),select"); if (first && matchMedia("(pointer:fine)").matches) first.focus(); }
      else if (e.target.closest("#drawerHost,#itemBox")) e.target.remove();
    }
  }, true);

  // ---- Tidying what the pages draw ----
  // Boxes in panels get a real label that stays visible once something is typed.
  function labelBoxes(root) {
    root.querySelectorAll("details.form input, details.form select").forEach((el) => {
      if (el.closest("label") || el.dataset.done || ["radio", "checkbox", "file", "search", "hidden"].includes(el.type)) return;
      el.dataset.done = 1;
      const text = el.tagName === "SELECT" ? (el.options[0]?.value === "" ? el.options[0].text.replace(/…$/, "") : el.getAttribute("aria-label")) : el.placeholder || el.getAttribute("aria-label") || (el.type === "date" ? "Date" : "");
      if (!text) return;
      const label = document.createElement("label");
      label.className = "sub";
      el.replaceWith(label);
      label.append(text, el);
      if (el.tagName !== "SELECT") el.placeholder = "";
    });
  }
  // On a phone a table row becomes a small card; each value carries its column name.
  function tableLabels(root) {
    root.querySelectorAll(".panel:not(#tab-reports) table").forEach((t) => {
      const heads = [...t.querySelectorAll("thead th")].map((th) => th.textContent.replace(/[⇅]/g, "").trim());
      if (!heads.length) return;
      t.querySelectorAll("tbody tr").forEach((tr) => [...tr.children].forEach((td, i) => { if (heads[i] && td.colSpan === 1) td.dataset.l = heads[i]; }));
    });
  }
  const tidy = () => { labelBoxes(document.body); tableLabels(document.body); paintVeil(); };
  let queued = false;
  new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; tidy(); }); }).observe(document.body, { childList: true, subtree: true });

  // ---- Taking a payment, from anywhere it is owed ----
  async function collect(partyId, amount, ref) {
    const data = window.VX.data();
    const p = data.parties.find((x) => x.id === partyId) || (await api("/api/billing/parties")).find((x) => x.id === partyId);
    if (!p) return toast("Party not found.", { bad: true });
    const inward = p.type !== "supplier" && p.balance >= 0, owed = Math.abs(p.balance);
    const box = drawer(inward ? "Payment In" : "Payment Out", `
      <div class="billHead"><div><b>${esc(p.name)}</b><div class="sub">${esc(p.phone || "")}${ref ? ` · ${esc(ref)}` : ""}</div></div><div class="n"><span class="sub">${inward ? "Owes you" : "You owe"}</span><br><b>${inr(owed)}</b></div></div>
      <label class="sub">Amount ₹<input id="cAmt" type="number" min="1" value="${esc(amount || owed || "")}"></label>
      <div class="quick">${amount && amount !== owed ? `<button class="tbtn" data-amt="${amount}">This bill ${inr(amount)}</button>` : ""}${owed ? `<button class="tbtn" data-amt="${owed}">Full ${inr(owed)}</button>` : ""}</div>
      <div class="pay">${[["cash", "Cash"], ["upi", "UPI"], ["card", "Card"], ["bank", "Bank"]].map(([v, l], i) => `<label><input type="radio" name="cMode" value="${v}" ${i ? "" : "checked"}><span>${l}</span></label>`).join("")}</div>
      <div class="row2"><label class="sub">Date<input id="cDay" type="date" value="${today()}" max="${today()}"></label><label class="sub">Note<input id="cNote" value="${esc(ref || "")}"></label></div>
      <button class="big" id="cSave">Save payment</button><div class="err" id="cErr"></div>`);
    box.querySelectorAll("[data-amt]").forEach((b) => (b.onclick = () => ($("cAmt").value = b.dataset.amt)));
    $("cAmt").select();
    $("cSave").onclick = async () => {
      $("cSave").disabled = true;
      try {
        await api("/api/billing/payments", { method: "POST", body: JSON.stringify({ direction: inward ? "in" : "out", partyId, amount: $("cAmt").value, day: $("cDay").value, mode: box.querySelector("input[name=cMode]:checked").value, note: $("cNote").value }) });
        const paid = Number($("cAmt").value); closeDrawer(); toast(`${inr(paid)} payment saved.`);
        await window.VX.reload();
        await window.VX.reloadTab();
      } catch (e) { $("cSave").disabled = false; $("cErr").textContent = e.message; }
    };
  }

  // A WhatsApp nudge. The UPI ID comes from the shop's details, so it never goes stale.
  function reminder(p, amount) {
    const { me } = window.VX.data();
    const pay = me.upi ? ` You can pay on UPI ${me.upi}.` : "";
    return `https://wa.me/91${p.phone}?text=${encodeURIComponent(`Hi ${p.name}, this is Vibe X. Your balance with us is ${inr(amount)}.${pay} Thank you!`)}`;
  }

  // ---- Search everything ----
  const PAGES = [...document.querySelectorAll("#side .nv[data-tab]")].map((b) => ({ label: b.childNodes[0].textContent.trim(), tab: b.dataset.tab, sub: b.dataset.sub }));
  let hits = [], at = 0;
  function find(text) {
    const q = text.trim().toLowerCase();
    const { products, invoices, parties, role } = window.VX.data();
    if (!q) return [];
    const staff = role === "staff", words = q.split(/\s+/), has = (s) => words.every((w) => s.toLowerCase().includes(w));
    const out = [];
    for (const p of PAGES) if (has(p.label) && !(staff && !["bills", "stock"].includes(p.tab))) out.push({ group: "Pages", title: p.label, sub: "", run: () => go(p.tab, p.sub) });
    for (const x of invoices) if (has(`${x.number} ${x.customer.name} ${x.customer.phone} ${x.order || ""}`)) { out.push({ group: "Bills", title: `Bill ${x.number}`, sub: `${x.customer.name || "Walk-in"} · ${inr(x.total)} · ${istDate(x.at)}`, run: async () => { await go("bills"); window.VX.billPanel(x.id); } }); if (out.filter((o) => o.group === "Bills").length >= 5) break; }
    if (!staff) for (const p of parties.filter((p) => has(`${p.name} ${p.phone}`)).slice(0, 5)) out.push({ group: "Parties", title: p.name, sub: `${p.phone || ""}${p.balance ? ` · ${p.balance > 0 ? "owes" : "you owe"} ${inr(Math.abs(p.balance))}` : ""}`, run: () => go("parties", p.id) });
    for (const p of products.filter((p) => has(`${p.name} ${p.code} ${p.barcode || ""}`)).slice(0, 6)) out.push({ group: "Items", title: p.name, sub: `#${p.code} · ${p.quantity ?? 0} in stock · ${inr(p.price)}`, run: async () => { if (staff) { await go("new"); window.VX.addToCart(p.id); } else { await go("stock"); window.VX.itemForm(p); } } });
    return out;
  }
  function paintFind() {
    const box = $("findHits");
    box.classList.toggle("hide", !$("findAll").value.trim());
    let group = "";
    box.innerHTML = hits.length ? hits.map((h, i) => { const head = h.group !== group ? `<h6>${h.group}</h6>` : ""; group = h.group; return `${head}<button data-hit="${i}" class="${i === at ? "active" : ""}"><b>${esc(h.title)}</b>${h.sub ? `<span class="sub">${esc(h.sub)}</span>` : ""}</button>`; }).join("") : `<div class="empty">Nothing found.</div>`;
    box.querySelectorAll("[data-hit]").forEach((b) => (b.onmousedown = (e) => { e.preventDefault(); pick(+b.dataset.hit); }));
    box.querySelector(".active")?.scrollIntoView({ block: "nearest" });
  }
  const pick = (i) => { const h = hits[i]; $("findAll").value = ""; $("findAll").blur(); hits = []; paintFind(); h?.run(); };
  $("findAll").oninput = () => { hits = find($("findAll").value); at = 0; paintFind(); };
  $("findAll").onblur = () => setTimeout(() => $("findHits").classList.add("hide"), 120);
  $("findAll").onfocus = () => { if ($("findAll").value.trim()) paintFind(); };
  $("findAll").onkeydown = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); at = Math.max(0, Math.min(hits.length - 1, at + (e.key === "ArrowDown" ? 1 : -1))); paintFind(); }
    if (e.key === "Enter") { e.preventDefault(); pick(at); }
    if (e.key === "Escape") { $("findAll").value = ""; $("findAll").blur(); hits = []; paintFind(); }
  };

  // ---- Keyboard ----
  document.addEventListener("keydown", (e) => {
    const typing = e.target.matches?.("input,select,textarea");
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === "k") { e.preventDefault(); $("findAll").focus(); $("findAll").select(); return; }
    if (e.key === "F2") { e.preventDefault(); go("new"); return; }
    if (ctrl && e.key === "Enter") { e.preventDefault(); window.VX.makeBill(); return; }
    if (e.key === "Escape" && openPanels().length) { e.preventDefault(); closeDrawer(); return; }
    if (e.key === "/" && !typing) { e.preventDefault(); $("findAll").focus(); }
  });

  Object.assign(window.VX, { twoTap, drawer, closeDrawer, collect, reminder, today });
})();
