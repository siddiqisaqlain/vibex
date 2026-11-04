// Flat product illustrations used until a real photo is sent. Picked from the item's name
// and category, tinted per item, so the rack never shows an empty grey box.
window.productArt = (() => {
  const INK = "#151410";
  const s = `stroke="${INK}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"`;
  const SHAPES = {
    puffer: (f) => `
      <path d="M72 42 L128 42 L166 72 L180 178 L153 183 L146 112 L146 216 L54 216 L54 112 L47 183 L20 178 L34 72 Z" fill="${f}" ${s}/>
      <path d="M54 84 H146 M54 116 H146 M54 148 H146 M54 180 H146 M40 104 L52 102 M160 104 L148 102 M37 136 L50 134 M163 136 L150 134" fill="none" ${s} stroke-width="3.5"/>
      <path d="M100 46 V216" fill="none" ${s} stroke-width="3.5"/>
      <path d="M72 42 Q100 70 128 42" fill="${f}" ${s}/>`,
    hoodie: (f) => `
      <path d="M70 48 L130 48 L168 76 L178 182 L152 186 L146 116 L146 216 L54 216 L54 116 L48 186 L22 182 L32 76 Z" fill="${f}" ${s}/>
      <path d="M70 50 Q72 12 100 12 Q128 12 130 50 Q100 74 70 50 Z" fill="${f}" ${s}/>
      <path d="M68 168 H132 L124 196 H76 Z" fill="none" ${s} stroke-width="3.5"/>
      <path d="M92 64 V96 M108 64 V96" ${s} stroke-width="3"/>
      <path d="M54 204 H146" ${s} stroke-width="3.5"/>`,
    tee: (f) => `
      <path d="M70 44 L130 44 L172 70 L156 104 L140 96 L140 216 L60 216 L60 96 L44 104 L28 70 Z" fill="${f}" ${s}/>
      <path d="M78 44 Q100 66 122 44" fill="none" ${s}/>`,
    pants: (f) => `
      <path d="M58 30 H142 L152 226 H112 L100 96 L88 226 H48 Z" fill="${f}" ${s}/>
      <path d="M58 48 H142 M70 48 Q74 72 60 78 M130 48 Q126 72 140 78 M100 48 V96" fill="none" ${s} stroke-width="3.5"/>`,
    shoe: (f) => `
      <path d="M22 168 Q24 120 58 112 L96 116 Q122 142 170 150 Q186 154 184 172 Z" fill="${f}" ${s}/>
      <path d="M20 168 H186 V184 Q186 190 180 190 H26 Q20 190 20 184 Z" fill="#f4eee1" ${s}/>
      <path d="M70 122 L84 132 M78 116 L92 128 M88 112 L100 124" ${s} stroke-width="3.5"/>
      <path d="M120 152 Q140 140 160 156" fill="none" ${s} stroke-width="3.5"/>`,
    bottle: (f) => `
      <rect x="80" y="30" width="40" height="34" rx="4" fill="${INK}"/>
      <rect x="88" y="64" width="24" height="16" fill="#f4eee1" ${s}/>
      <rect x="52" y="80" width="96" height="138" rx="14" fill="${f}" ${s}/>
      <rect x="68" y="122" width="64" height="54" fill="#f4eee1" ${s} stroke-width="3.5"/>
      <path d="M78 140 H122 M84 156 H116" ${s} stroke-width="3"/>
      <path d="M62 96 V200" stroke="rgba(255,255,255,.45)" stroke-width="6" stroke-linecap="round"/>`,
  };
  const TINTS = ["#c9b48a", "#8f9a6a", "#d27443", "#9fb2b6", "#d9c7a0", "#b4936b", "#7f8a5b"];

  function pick(p) {
    const t = `${p.name} ${p.caption || ""}`.toLowerCase();
    if (p.category === "Fragrances") return "bottle";
    if (p.category === "Footwear") return "shoe";
    if (/puffer|jacket|parka|coat|shell|nuptse|down|blazer|windbreaker/.test(t)) return "puffer";
    if (/hoodie|fleece|sweater|sweatshirt|vest|cardigan|pullover/.test(t)) return "hoodie";
    if (/jean|pant|trouser|chino|cargo|jogger|sweatpant|short/.test(t)) return "pants";
    return "tee";
  }

  return (p, seed) => {
    const tint = TINTS[seed % TINTS.length];
    return `<svg class="art" viewBox="0 0 200 240" role="img" aria-label="${pick(p)} illustration">${SHAPES[pick(p)](tint)}</svg>`;
  };
})();
