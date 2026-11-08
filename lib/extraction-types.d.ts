declare module 'mammoth/mammoth.browser' {
  const mammoth: {extractRawText(input: {arrayBuffer: ArrayBuffer}): Promise<{value: string}>};
  export default mammoth;
}
declare module 'html-to-text' {
  export function convert(html: string, options?: object): string;
}
