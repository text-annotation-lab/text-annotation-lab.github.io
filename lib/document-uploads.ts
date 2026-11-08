type QueuedDocument = {file: File; sourceFile?: File};
const fingerprints = new WeakMap<File, Promise<string>>();

function fingerprint(file: File) {
  let result = fingerprints.get(file);
  if (!result) {
    result = file.arrayBuffer()
      .then(bytes => crypto.subtle.digest('SHA-256', bytes))
      .then(hash => Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(''))
      .catch(error => { fingerprints.delete(file); throw error; });
    fingerprints.set(file, result);
  }
  return result;
}

// A matching name and size is only a candidate duplicate, never proof of one.
export async function prepareDocumentUploads(files: File[], documents: QueuedDocument[]) {
  const known = [...new Set(documents.flatMap(doc => [doc.file, ...(doc.sourceFile ? [doc.sourceFile] : [])]))];
  const accepted: File[] = [], duplicateFiles: File[] = [], validFiles: File[] = [];
  let rejected = 0, duplicates = 0, unreadable = 0, matchingNames = 0;
  for (const file of files) {
    if (!/\.(txt|md|pdf|docx|html?|rtf)$/i.test(file.name) || !file.size || file.size > 20 * 1024 * 1024) {
      rejected++;
      continue;
    }
    const sameName = known.filter(existing => existing.name === file.name);
    let duplicate = false;
    try {
      for (const existing of sameName.filter(existing => existing.size === file.size)) {
        if (existing === file || await fingerprint(existing) === await fingerprint(file)) {
          duplicate = true;
          break;
        }
      }
    } catch {
      unreadable++;
      continue;
    }
    validFiles.push(file);
    if (duplicate) { duplicates++; duplicateFiles.push(file); continue; }
    if (sameName.length) matchingNames++;
    accepted.push(file);
    known.push(file);
  }
  return {accepted, duplicateFiles, validFiles, rejected, duplicates, unreadable, matchingNames};
}
