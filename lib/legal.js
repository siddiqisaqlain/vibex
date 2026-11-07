// Policy pages, built from shop.json so the owner's real details and time windows appear everywhere.
// Written to cover what an Indian online shop has to show:
//   - Consumer Protection (E-Commerce) Rules, 2020: seller's legal name, address and contact,
//     a grievance officer (complaints acknowledged in 48 hours, resolved within a month),
//     return / refund / exchange / shipping / payment terms, total price before payment.
//   - Digital Personal Data Protection Act, 2023: who is responsible for the data, what is
//     collected and why, who it is shared with, how long it is kept, the customer's rights
//     and how to complain.
// Until the owner fills shop.json and sets policy.confirmed, each page says it is being
// finalised and lists what is missing. This is a template, not legal advice.

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Fields the owner still has to fill (shown on the policy pages, and in the server log).
function missing(shop) {
  const b = shop.business || {};
  const g = b.grievanceOfficer || {};
  const out = [];
  if (!b.legalName) out.push("the shop's legal name");
  if (!b.address) out.push("the store's full address");
  if (!b.phone && !b.email) out.push("a customer care phone number or email");
  if (!g.name || (!g.phone && !g.email)) out.push("a grievance officer's name and contact");
  if (!shop.whatsapp) out.push("the shop's WhatsApp number");
  if (shop.pay?.demo) out.push("real UPI / bank payment details");
  if (!shop.policy?.confirmed) out.push("the owner's approval of these policies");
  return out;
}

function contactLines(shop) {
  const b = shop.business || {};
  const lines = [];
  if (b.legalName) lines.push(`<b>${esc(b.legalName)}</b>`);
  if (b.address) lines.push(esc(b.address));
  if (b.phone) lines.push(`Phone: <a href="tel:${esc(b.phone.replace(/[^\d+]/g, ""))}">${esc(b.phone)}</a>`);
  const wa = String(shop.whatsapp || "");
  const waShown = /^91\d{10}$/.test(wa) ? `+91 ${wa.slice(2, 7)} ${wa.slice(7)}` : `+${wa}`;
  if (wa) lines.push(`WhatsApp: <a href="https://wa.me/${esc(wa)}">${esc(waShown)}</a>`);
  if (b.email) lines.push(`Email: <a href="mailto:${esc(b.email)}">${esc(b.email)}</a>`);
  if (shop.instagram) lines.push(`Instagram: <a href="${esc(shop.instagram)}">@${esc(shop.igHandle || "")}</a>`);
  if (b.gstin) lines.push(`GSTIN: ${esc(b.gstin)}`);
  return lines.length ? `<p>${lines.join("<br>")}</p>` : `<p>Message us on Instagram at <a href="${esc(shop.instagram)}">@${esc(shop.igHandle)}</a>, or visit the store in ${esc(shop.city)}.</p>`;
}

function grievance(shop) {
  const g = (shop.business || {}).grievanceOfficer || {};
  const who = g.name
    ? `<p>Grievance officer: <b>${esc(g.name)}</b>${g.phone ? `, ${esc(g.phone)}` : ""}${g.email ? `, <a href="mailto:${esc(g.email)}">${esc(g.email)}</a>` : ""}</p>`
    : "";
  return `${who}<p>We acknowledge every complaint within 48 hours and resolve it within one month of receiving it. If you are not satisfied, you can approach the National Consumer Helpline (1915, <a href="https://consumerhelpline.gov.in">consumerhelpline.gov.in</a>) or the consumer commission for your area.</p>`;
}

function pages(shop) {
  const P = shop.policy || {};
  const name = esc(shop.name);
  const fee = P.shippingFee != null ? `₹${Number(P.shippingFee).toLocaleString("en-IN")}` : null;
  return {
    returns: {
      title: "Returns and refunds",
      summary: `How returns, exchanges, cancellations and refunds work at ${shop.name}.`,
      html: `
      <p>Most pieces at ${name} are singles, so please ask us about size and condition before you order. We're happy to send extra photos and measurements.</p>
      <h2>Wrong or damaged</h2>
      <p>If your order arrives damaged, or isn't the piece shown on the website, tell us within ${esc(P.damageReportHours)} hours of delivery with photos. We'll replace it if we have one, or refund you in full, including shipping.</p>
      <h2>Change of mind</h2>
      <p>Store pickups can be checked and tried on before you take them home. We accept change-of-mind returns within ${esc(P.changeOfMindDays)} days of delivery or purchase when the piece is unused, unwashed and has its tags. For delivered orders you pay the return shipping, and we refund the item price once it reaches us.</p>
      <h2>Fragrances</h2>
      <p>For hygiene reasons, fragrances can be returned only if the seal is unbroken, or if the bottle arrives damaged or is not genuine.</p>
      <h2>Not genuine</h2>
      <p>Everything we sell is original. If a piece turns out not to be genuine, we refund you in full, including shipping, whenever you find out.</p>
      <h2>Cancelling an order</h2>
      <p>You can cancel any time before we dispatch it, for a full refund. Once it is dispatched, the change-of-mind terms above apply.</p>
      <h2>Refunds</h2>
      <p>Refunds go back to the account you paid from, within ${esc(P.refundWorkingDays)} working days of us approving the return or cancellation.</p>
      <h2>Contact and complaints</h2>
      ${contactLines(shop)}${grievance(shop)}`,
    },
    terms: {
      title: "Terms of sale",
      summary: `The terms that apply when you order from ${shop.name}.`,
      html: `
      <h2>Who we are</h2>
      <p>${name}${shop.tagline ? ` (${esc(shop.tagline)})` : ""} is a store in ${esc(shop.city)} selling original branded surplus clothing, footwear and fragrances. This website is our own shop; we are the seller of every item on it.</p>
      ${contactLines(shop)}
      <h2>Products</h2>
      <p>Pieces are surplus stock, so most are available as a single unit. Photos show the actual piece or the same model; colours can look slightly different on screens. Ask us for any product detail, such as the label, MRP, net quantity, manufacturer or importer, or country of origin, and we'll send photos before you buy.</p>
      <h2>Prices and payment</h2>
      <p>Prices are in Indian rupees and include all taxes. ${P.courier?.perKg ? `Store pickup is free. Delivery outside Kashmir costs ₹${esc(P.courier.perKg)} per kg, and you see the exact amount before you pay. Inside Kashmir, we tell you the courier charge on WhatsApp before we dispatch, and if you don't want to pay it you can cancel for a full refund.` : fee ? `Delivery costs ${fee}, shown before you pay.` : "Store pickup is free. For delivery, the courier charge depends on your location: we tell you the exact amount on WhatsApp before we dispatch, and if you don't want to pay it you can cancel for a full refund."} You pay by UPI, bank transfer or to our payments number; payment goes straight to our account. An order is confirmed only when we have matched your payment and told you so on WhatsApp.</p>
      <h2>Holds and cancellations</h2>
      <p>If you start an order for the last piece, it's held for you for 10 minutes so nobody else can order it. If you leave, it's released straight away.</p>
      <p>When you send payment details, the piece is held for you while we check the payment. If we can't match a payment, we'll contact you, and we may release the hold if we don't hear back. If a piece sells in store at the same moment, we refund you in full.</p>
      <h2>Delivery</h2>
      <p>We dispatch within ${esc(P.dispatchWorkingDays)} working days of confirming your payment and ship across India through courier partners, sharing tracking on WhatsApp. Delivery usually takes ${esc(P.deliveryDays)} days after dispatch, depending on your location.</p>
      <h2>Returns</h2>
      <p>See our <a href="/returns">returns and refunds policy</a>.</p>
      <h2>Complaints</h2>
      ${grievance(shop)}
      <h2>Law</h2>
      <p>These terms are governed by the laws of India. Courts in Srinagar, Jammu and Kashmir, have jurisdiction, without affecting your right to approach a consumer commission.</p>`,
    },
    privacy: {
      title: "Privacy",
      summary: `What ${shop.name} does with the details you share.`,
      html: `
      <h2>Who is responsible</h2>
      <p>${esc((shop.business || {}).legalName || shop.name)} decides how your details are used (the "data fiduciary" under India's Digital Personal Data Protection Act, 2023).</p>
      ${contactLines(shop)}
      <h2>What we collect</h2>
      <p>Only what you give us when you enquire or order: your name, mobile/WhatsApp number, delivery address if you choose delivery, any note you write, and any payment details you share with us. We don't collect anything else about you.</p>
      <p>To order online you need an account. If you sign in with WhatsApp, you send us a short code from your WhatsApp, and we keep the number it came from. If you sign in with Google, Google tells us your name and email address, and we keep those. Your account also keeps your bag, your wishlist, your saved address, your orders and your coins (1 coin for every ₹100 you pay, given once we confirm the payment).</p>
      <h2>Why we use it</h2>
      <p>To answer your question, check your payment, deliver your order, handle returns and refunds, and keep the records the law requires. By sending your details you agree to this use. We don't sell your details, and we don't send marketing unless you ask.</p>
      <h2>Who else sees it</h2>
      <ul>
        <li>The ${name} team.</li>
        <li>Visitors to our website: when you buy, the site may show your first name and city with what you bought. You can turn this off when you order online. In the store, we only show your name if you agree.</li>
        <li>Our courier partner, for delivery (name, number and address only).</li>
        <li>WhatsApp (Meta), which carries our messages to you under its own privacy terms.</li>
        <li>Google, only if you choose to sign in with Google, under its own privacy terms.</li>
        <li>Render, the company that hosts this website. Its servers are in the United States.</li>
      </ul>
      <h2>Cookies</h2>
      <p>This website uses no tracking cookies or advertising pixels. Its fonts load from Google Fonts, which receives your browser's IP address when you open a page. The home page shows the picture for our latest YouTube video, loaded from YouTube, which also receives your IP address. The YouTube player itself loads only if you press play, and YouTube's privacy policy then applies.</p>
      <p>When you sign in, we set one cookie that keeps you signed in on that browser for up to 6 months. It is needed for your account to work, holds only a random key, and is removed when you sign out. Before you sign in, your bag and wishlist are kept in your own browser.</p>
      <p>If you tell the home page your first name, or place an order, your first name is kept in your own browser so we can say hello next time. It stays on your device and isn't sent to us from there. "Not you?" in the home page greeting removes it.</p>
      <p>To see where the site works and where people get stuck, we count visits ourselves. Your browser keeps a random number that isn't connected to your name, and sends us which pages and which parts of a page you look at and for how long, how far you scroll, what you press, which products appear on your screen, where on a section you press, which boxes you use in a form and how long each takes (including how long before you start typing, how many keys you pressed and corrected, whether a box was pasted into, filled in by your device or left empty), how fast pages load for you, how you reached us, your type of device and connection, your screen size and your time zone. Using what you do during your visit, your own browser estimates how likely you are to order and may show you a helpful note, such as help with sizes or payment. It may also tell you how many other people are looking at a piece right now, as a plain count with no names. If you ask us to tell you when a sold piece comes back, we keep your number for up to 30 days and use it only for that. This never changes a price: everyone pays the same. About 1 in 7 visitors see no notes, so we can tell whether they help. We never record what you type into forms, or your IP address. This is stored by Render, which hosts the site, and shared with nobody else. Turn on Global Privacy Control in your browser and none of this is sent. If you answer one of our short questions, your answer and any note you add are kept too.</p>
      <h2>How long we keep it</h2>
      <p>Visit records are deleted after about 13 months. Enquiries are deleted within 12 months. Your account stays until you ask us to delete it; unused coins go with it. Order and payment records are kept for as long as tax law requires (usually 6 to 8 years), then deleted.</p>
      <h2>Your rights</h2>
      <p>You can ask us to show you the details we hold about you, correct them, or delete them (except records the law makes us keep), withdraw your consent, or name someone to act for you. Ask on WhatsApp${(shop.business || {}).email ? " or by email" : ""}, and we'll reply within 7 days.</p>
      <h2>Children</h2>
      <p>This shop is for adults. If you are under 18, please ask a parent or guardian to order for you.</p>
      <h2>Complaints</h2>
      ${grievance(shop)}
      <p>You can also complain to the Data Protection Board of India.</p>`,
    },
    contact: {
      title: "Contact us",
      summary: `How to reach ${shop.name}, and how to raise a complaint.`,
      html: `
      ${contactLines(shop)}
      ${shop.maps ? `<p><a href="${esc(shop.maps)}" target="_blank" rel="noopener">Directions to the store ↗</a></p>` : ""}
      <h2>Complaints and grievances</h2>
      ${grievance(shop)}
      <p>See also our <a href="/returns">returns and refunds</a>, <a href="/terms">terms of sale</a> and <a href="/privacy">privacy</a> pages.</p>`,
    },
  };
}

module.exports = { pages, missing };
