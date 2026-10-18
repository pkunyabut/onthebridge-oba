// Text from a PDF file (agency documents / official reports)
// Only a PDF with a text layer can be read — a scanned image or a locked PDF gives empty text and is rejected by the caller

export const MAX_PDF_BYTES = 20_000_000;
const MAX_PDF_PAGES = 60;
const MAX_PDF_CHARS = 400_000;

export async function pdfToText(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false, verbosity: 0 });
  const doc = await task.promise;
  try {
    let text = '';
    for (let i = 1; i <= Math.min(doc.numPages, MAX_PDF_PAGES) && text.length < MAX_PDF_CHARS; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(it => (it.str || '') + (it.hasEOL ? '\n' : ' ')).join('') + '\n\n';
    }
    let title = '';
    try { title = String((await doc.getMetadata()).info?.Title || '').trim(); } catch { /* no title in the metadata */ }
    const clean = text.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_PDF_CHARS);
    return { text: clean, title, pages: doc.numPages };
  } finally {
    await task.destroy();
  }
}
