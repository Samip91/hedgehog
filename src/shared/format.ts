/**
 * Pure, `Intl`-backed money/price formatters shared across feature slices
 * (`hedge`'s proposal cards, `hedges`' saved-hedge cards). No ad-hoc
 * `toFixed`/string interpolation belongs in JSX.
 */

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})

/** `1234.5` → `"$1,234.50"`. */
export function formatUsd(value: number): string {
  return usdFormatter.format(value)
}

/** A market side's price in (0, 1) → cents, e.g. `0.24` → `"24¢"`. */
export function formatPrice(price: number): string {
  return `${Math.round(price * 100)}¢`
}
