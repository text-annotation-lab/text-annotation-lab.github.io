export function missingAnnotationSetup(apiKey: string, prompt: string): string | undefined {
 const missing = [!apiKey.trim() && 'API key', !prompt.trim() && 'annotation prompt'].filter(Boolean);
 return missing.length ? `Add your ${missing.join(' and ')} first.` : undefined;
}

export function remainingEstimateNotice(rows: {status: string}[]): string | undefined {
 if (!rows.length || rows.some(row => row.status === 'pending')) return undefined;
 if (rows.every(row => row.status === 'done')) return 'All annotations are complete. There is no queued work to estimate. Recorded costs are shown separately when available.';
 if (rows.some(row => row.status === 'running' || row.status === 'queued')) return 'Annotations are in progress or submitted as a batch. There are no additional queued items to estimate. Costs for the work already started are not included here.';
 return 'No annotations are currently queued. Some items need attention; review their errors and queue any you want to retry, then estimate again. Your completed results are kept.';
}

// Notices that only confirm what the student just did. They are shown in a neutral
// color; anything carrying a caveat (skipped files, errors, next steps) stays a warning.
export function isPlainConfirmation(notice: string): boolean {
 return /^(\d+ documents? added\.|Checking selected documents…|Results cleared\. Your documents are ready to annotate again with the current settings\.)$/.test(notice.trim());
}

// What a run that paces itself (research mode) reports when the provider refuses requests for a rate limit. It is
// information, shown in the neutral color: the run goes on by itself.
export const isRateLimitNotice = (notice: string): boolean => /^At \S.* the provider reported a rate limit: a pause of about /.test(notice);
export function rateLimitNotice(limited: {at: number; waitMs: number; atOnce: number}, unit: string): string {
 const time = new Date(limited.at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'});
 const seconds = Math.max(1, Math.round(limited.waitMs / 1000));
 return `At ${time} the provider reported a rate limit: a pause of about ${seconds} second${seconds === 1 ? '' : 's'}, then up to ${limited.atOnce === 1 ? `one ${unit}` : `${limited.atOnce} ${unit}s`} at a time, rising again as requests get through.`;
}
