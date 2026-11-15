// How labels are read before they are compared (shared by the workspace view and the statistics).

/** A number as typed: a leading minus sign may be a real minus or an en dash. */
export function toNumber(s: string): number {
  const t = s.trim().replace(/^[\u2212\u2013]/, '-');
  return t === '' ? NaN : Number(t);
}

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
