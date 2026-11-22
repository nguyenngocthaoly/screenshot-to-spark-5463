/** Display-only formatting. No business numbers are computed here. */
const cache = new Map<number, Intl.NumberFormat>();

export function formatNumber(value: number, decimals: number): string {
  let f = cache.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    cache.set(decimals, f);
  }
  const out = f.format(value);
  return out === "-0" || out === "-0.00" ? out.slice(1) : out;
}

export function formatRate(rate: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(rate);
}

export function formatQty(qty: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(qty);
}
