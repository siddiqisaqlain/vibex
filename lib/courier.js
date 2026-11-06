// What delivery costs, from shop.json -> policy.courier. The server is the only place this is worked out: the order
// total comes from here, and the checkout only shows it. The courier charge is kept apart from the selling price.
function courierFor(c, product, pin) {
  if (!c?.perKg) return { fee: null, inside: false, kg: 0 };
  const inside = (c.kashmirPins || []).some((x) => String(pin).startsWith(x));
  const kg = c.kg?.[product.subcategory] ?? c.kg?.[product.category] ?? c.kg?.default ?? 1;
  if (inside) return { fee: c.insideKashmir ?? null, inside, kg };
  return { fee: Math.ceil(kg * c.perKg), inside, kg };
}

module.exports = { courierFor };
