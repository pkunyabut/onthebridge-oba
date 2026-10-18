import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pdfToText } from '../src/adapters/pdfText.mjs';

// A tiny hand-made PDF (no xref table — pdfjs rebuilds the structure by itself)
function tinyPdf(text) {
  const stream = `BT /F1 18 Tf 20 100 Td (${text}) Tj ET`;
  return Buffer.from(`%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 900 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length ${stream.length} >> stream
${stream}
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
trailer << /Root 1 0 R /Size 6 >>
%%EOF`, 'latin1');
}

test('pdfToText reads the text layer of a PDF', async () => {
  const out = await pdfToText(tinyPdf('TikTok agreed to pay 100 million dollars'));
  assert.equal(out.pages, 1);
  assert.match(out.text, /TikTok agreed to pay 100 million dollars/);
});

test('pdfToText rejects bytes that are not a PDF', async () => {
  await assert.rejects(() => pdfToText(Buffer.from('not a pdf at all')));
});
