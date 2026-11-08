import { rtfText } from './rtf-text';

export const supportedFile = /\.(pdf|txt|md|docx|html?|rtf)$/i;

export class TextEncodingError extends Error {
  constructor() { super('This document’s text encoding could not be read safely. Save it as UTF-8 TXT and upload it again.'); }
}

async function decodeText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
    : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    // NULs commonly indicate BOM-less UTF-16 or a binary file labeled as text.
    if (text.includes('\0')) throw new TextEncodingError();
    return text;
  } catch { throw new TextEncodingError(); }
}

export async function extractText(file: File): Promise<string> {
  if (/\.docx$/i.test(file.name)) {
    const {default:mammoth}=await import('mammoth/mammoth.browser');
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value;
  }
  if (/\.rtf$/i.test(file.name)) {
    const bytes = await file.arrayBuffer();
    const header = new TextDecoder('windows-1252').decode(bytes);
    const codepage = /\\ansicpg(\d+)/.exec(header)?.[1] || '1252';
    const encoding = codepage === '65001' ? 'utf-8' : codepage === '932' ? 'shift_jis' : codepage === '936' ? 'gbk' : codepage === '950' ? 'big5' : `windows-${codepage}`;
    let raw: string;
    try { raw = new TextDecoder(encoding).decode(bytes); } catch { throw new Error('This RTF character encoding is unsupported. Save as DOCX or UTF-8 TXT.'); }
    return rtfText(raw);
  }
  const raw = await decodeText(file);
  if (/\.html?$/i.test(file.name)) {
    const {convert}=await import('html-to-text');
    return convert(raw, {
      wordwrap: false,
      selectors: [
        { selector: 'a', options: { ignoreHref: true } },
        { selector: 'img', format: 'skip' },
        { selector: 'script', format: 'skip' },
        { selector: 'style', format: 'skip' },
        { selector: 'head', format: 'skip' },
      ],
    });
  }
  return raw;
}
