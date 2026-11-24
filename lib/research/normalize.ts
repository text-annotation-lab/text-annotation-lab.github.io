// How labels are read before they are compared (shared by the workspace view and the statistics).

const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
/**
 * A number as typed: a leading minus sign may be a real minus or an en dash. Only decimal notation counts, and only
 * a number that can be held: "0x10", "Infinity", and "1e309" are text, not numbers.
 */
export function toNumber(s: string): number {
  const t = s.trim().replace(/^[\u2212\u2013]/, '-');
  const x = DECIMAL.test(t) ? Number(t) : NaN;
  return Number.isFinite(x) ? x : NaN;
}
/** An answer that says the model cannot tell (Model knowledge). It is no value of a field: neither a number nor a category of it. */
export const abstains = (s: string): boolean => s.trim().toUpperCase() === 'INSUFFICIENT_KNOWLEDGE';
/** Whether a label as the statistics read it (normalizeLabel) is a number; the same rule as toNumber, with a plain minus. */
export const isPlainNumber = (s: string): boolean => DECIMAL.test(s.trim()) && Number.isFinite(Number(s));
/** The lowest and the highest of a list of any length (Math.min(...list) fails on a very long one). Empty: Infinity, −Infinity. */
export function lowest(xs: number[]): number { let m = Infinity; for (const x of xs) if (x < m) m = x; return m; }
export function highest(xs: number[]): number { let m = -Infinity; for (const x of xs) if (x > m) m = x; return m; }

/** Labels are compared after trimming and lower-casing; yes/true and no/false are treated alike. */
export function normalizeLabel(v: string | undefined, yesNo = false): string {
  if (v === undefined) return '';
  // (Runs of spaces inside count as one: "very  positive" is "very positive".)
  const s = v.trim().toLowerCase().replace(/\s+/g, ' ');
  // A yes/no field also reads 1/0, y/n and Danish ja/nej.
  if (s === 'true' || s === 'yes' || (yesNo && (s === '1' || s === 'y' || s === 'ja'))) return 'true';
  if (s === 'false' || s === 'no' || (yesNo && (s === '0' || s === 'n' || s === 'nej'))) return 'false';
  if (!Number.isNaN(toNumber(s))) return String(toNumber(s));
  if (yesNo && s.includes(' | ')) return [...new Set(s.split(' | ').map((x) => normalizeLabel(x, true)))].sort().join(' | ');
  return s;
}
