import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { excelBufferToText, importUniversal } from '../src/skills/universalImporter.mjs';

async function makeXlsx(build) {
  const wb = new ExcelJS.Workbook();
  build(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('excelBufferToText reads sheets in order, tab-separated, with empty cells kept in place (Thai text included)', async () => {
  const buf = await makeXlsx(wb => {
    const a = wb.addWorksheet('Products');
    a.addRow(['Name', 'Quantity', 'Price']);
    a.addRow(['Rice', 5, 45.5]);
    a.addRow(['ข้าวสาร', null, 120]);
    wb.addWorksheet('Summary').addRow(['Total', 3]);
  });
  const { text, sheets } = await excelBufferToText(buf);
  assert.deepEqual(sheets, ['Products', 'Summary']);
  assert.match(text, /=== Products ===\nName\tQuantity\tPrice\nRice\t5\t45\.5\nข้าวสาร\t\t120\n/);
  assert.match(text, /=== Summary ===\nTotal\t3\n/);
});

test('formulas give their computed value, rich text and hyperlinks give their text, dates become YYYY-MM-DD, tabs/newlines inside a cell become spaces', async () => {
  const buf = await makeXlsx(wb => {
    const ws = wb.addWorksheet('S');
    ws.addRow([{ formula: '1+2', result: 3 }, { richText: [{ text: 'Bold' }, { text: 'Plain' }] }, { text: 'Link', hyperlink: 'https://example.com' }, new Date(Date.UTC(2026, 9, 14)), 'line one\nline two\ttab']);
  });
  const { text } = await excelBufferToText(buf);
  assert.match(text, /3\tBoldPlain\tLink\t2026-10-14\tline one line two tab\n/);
});

test('non-xlsx input (old .xls, text, empty, oversized) is refused with a clear message instead of crashing', async () => {
  await assert.rejects(() => excelBufferToText(Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0, 0])), /Only \.xlsx files are supported/);
  await assert.rejects(() => excelBufferToText(Buffer.from('a,b,c\n1,2,3')), /Only \.xlsx files are supported/);
  await assert.rejects(() => excelBufferToText(Buffer.alloc(0)), /Only \.xlsx files are supported/);
  await assert.rejects(() => excelBufferToText(Buffer.alloc(20 * 1024 * 1024 + 1)), /larger than 20 MB/);
  const corrupt = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('not really a zip')]);
  await assert.rejects(() => excelBufferToText(corrupt));
});

test('importUniversal(excel) returns an error object (not an exception) for bad files and the old xlsx package is gone', async () => {
  const r = await importUniversal({ type: 'excel', content: Buffer.from('hello').toString('base64'), filename: 'x.xlsx' }, '');
  assert.match(r.error, /Excel import failed/);
  await assert.rejects(() => import('xlsx'), 'xlsx must not be installed any more');
});
