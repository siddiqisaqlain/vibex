// Shop details. Fill in WHATSAPP (country code + number, digits only, e.g. "919876543210")
// to make the secondary button "chat on WhatsApp". Empty = it goes to Instagram.
window.SHOP = {
  name: "Vibe X",
  tagline: "The Surplus Room",
  city: "Srinagar, Kashmir",
  whatsapp: "",
  instagram: "https://www.instagram.com/vibex.india/",
  igHandle: "vibex.india", // "Ask on Instagram" opens a DM to this account
  maps: "https://maps.app.goo.gl/E9e1sXQU3FwTs4yN7",

  // ---- Payment details shown at checkout ----
  // DEMO VALUES. They are deliberately invalid so nobody can pay a stranger by mistake.
  // Replace every field with the shop's real details before going live, then set demo: false.
  pay: {
    demo: true,
    payee: "Vibe X",                     // name customers see in their UPI app
    upiId: "vibex.demo@notreal",          // e.g. "vibexindia@okaxis"
    qrImage: "",                          // optional: path to the shop's own printed QR, e.g. "/vendor/vibex-qr.png"
    phone: "+91 00000 00000",             // GPay / PhonePe / Paytm number
    bank: {
      accountName: "VIBE X (DEMO)",
      accountNumber: "000000000000",
      ifsc: "DEMO0000000",
      bankName: "Demo Bank, Srinagar",
    },
    // Delivery outside Srinagar. null = "we'll confirm shipping on WhatsApp".
    shippingFee: null,
  },
};
