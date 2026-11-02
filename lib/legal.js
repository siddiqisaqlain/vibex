// Draft policy pages. Every page shows a "draft for Vibe X to review" banner.
// The shop must confirm the details (time windows, who pays return shipping, contact
// details) before the site goes live.

const LEGAL = {
  returns: {
    title: "Returns and refunds",
    summary: "How returns, exchanges and refunds work at Vibe X.",
    html: `
      <p>Most pieces at Vibe X are singles, so please ask us about size and condition on WhatsApp before you order. We're happy to send extra photos and measurements.</p>
      <h2>If something is wrong</h2>
      <p>If your order arrives damaged, or isn't the piece shown on the website, message us on WhatsApp within 48 hours of delivery with photos. We'll arrange a replacement if we have one, or a full refund including shipping.</p>
      <h2>Change of mind</h2>
      <p>Store pickups can be checked and tried on before you take them home. For delivered orders, we accept change of mind returns within 3 days of delivery when the piece is unused, unwashed and has its tags. Return shipping is paid by the customer, and we refund the item price once it reaches us.</p>
      <h2>Fragrances</h2>
      <p>For hygiene reasons, fragrances can be returned only if the seal is unbroken or the bottle arrives damaged.</p>
      <h2>Refunds</h2>
      <p>Refunds go back to the account you paid from, usually within 5 working days of us receiving the return.</p>
      <h2>Contact</h2>
      <p>Message us on WhatsApp or Instagram at <a href="https://www.instagram.com/vibex.india/">@vibex.india</a>, or visit The Surplus Room in Srinagar.</p>`,
  },
  terms: {
    title: "Terms of sale",
    summary: "The terms that apply when you order from Vibe X.",
    html: `
      <h2>Who we are</h2>
      <p>Vibe X (The Surplus Room) is a store in Srinagar, Kashmir selling original branded surplus clothing, footwear and fragrances.</p>
      <h2>Products</h2>
      <p>Pieces are surplus stock, so most are available as a single unit. Photos show the actual piece or the same model. Small differences in colour between screens are normal.</p>
      <h2>Prices and payment</h2>
      <p>Prices are in Indian rupees and include applicable taxes. Shipping, if any, is confirmed on WhatsApp before dispatch. You pay by UPI, bank transfer or to our payments number. An order is confirmed only when we have matched your payment and told you so on WhatsApp.</p>
      <h2>Holds and cancellations</h2>
      <p>When you send payment details, the piece is held for you while we check the payment. If we can't match a payment, we'll contact you, and we may release the hold if we don't hear back. If a piece sells in store at the same moment, we refund you in full.</p>
      <h2>Delivery</h2>
      <p>We ship across India through courier partners and share tracking on WhatsApp. Delivery times depend on your location.</p>
      <h2>Returns</h2>
      <p>See our <a href="/returns">returns and refunds policy</a>.</p>`,
  },
  privacy: {
    title: "Privacy",
    summary: "What Vibe X does with the details you share.",
    html: `
      <h2>What we collect</h2>
      <p>When you enquire or order, we collect your name, WhatsApp number, delivery address if you choose delivery, and the payment reference or screenshot you send.</p>
      <h2>Why</h2>
      <p>Only to answer your question, confirm your payment, deliver your order and contact you about it. We don't sell your details or send marketing without asking.</p>
      <h2>Who sees it</h2>
      <p>The Vibe X team, and our courier partner for delivery. Messages to us travel through WhatsApp and are covered by WhatsApp's own privacy terms.</p>
      <h2>How long we keep it</h2>
      <p>Order records are kept as long as needed for accounts and tax. Ask us on WhatsApp to delete your details at any time, and we'll remove anything we don't need to keep by law.</p>`,
  },
};

module.exports = { LEGAL };
