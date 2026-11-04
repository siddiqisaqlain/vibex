// Code 128 barcodes as SVG, with no outside library. Set B for mixed text, set C (pairs of
// digits) for all-digit codes, which keeps his 12-digit barcodes short enough to print small.
(() => {
  const P = "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112".split(" ");
  function values(text) {
    const s = String(text);
    if (/^\d+$/.test(s) && s.length % 2 === 0) { const v = [105]; for (let i = 0; i < s.length; i += 2) v.push(Number(s.slice(i, i + 2))); return v; }
    if (/^\d{3,}$/.test(s)) { const v = [104, s.charCodeAt(0) - 32, 99]; for (let i = 1; i < s.length; i += 2) v.push(Number(s.slice(i, i + 2))); return v; }
    return [104, ...[...s].map((c) => c.charCodeAt(0) - 32)];
  }
  function bars(text) {
    const v = values(text);
    const check = v.reduce((sum, x, i) => sum + x * (i || 1), 0) % 103;
    return [...v, check, 106].map((x) => P[x]).join("");
  }
  window.code128 = function code128(text, { height = 40, unit = 1.4 } = {}) {
    const w = bars(text); let x = 10 * unit, rects = "";
    [...w].forEach((c, i) => { const width = Number(c) * unit; if (i % 2 === 0) rects += `<rect x="${x.toFixed(2)}" y="0" width="${width.toFixed(2)}" height="${height}"/>`; x += width; });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${(x + 10 * unit).toFixed(2)} ${height}" height="${height}" fill="#000" role="img" aria-label="Barcode ${text}">${rects}</svg>`;
  };
})();
