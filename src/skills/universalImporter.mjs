import { writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

import { DATA_DIR } from '../paths.mjs';
import { fetchPage } from '../adapters/webFetch.mjs';
const IMPORTS_DIR = join(DATA_DIR, 'imports');

async function ensureImportsDir() {
  await mkdir(IMPORTS_DIR, { recursive: true });
}

// ─── Universal Importer ──────────────────────────────────────────────────────

export async function importUniversal(source, key, provider = 'deepseek') {
  const { type, content, url, title, filename } = source;
  
  switch (type) {
    case 'pdf': return await importPDF(content, filename, key, provider);
    case 'word': return await importWord(content, filename, key, provider);
    case 'excel': return await importExcel(content, filename, key, provider);
    case 'markdown': return await importMarkdown(content, filename, key, provider);
    case 'csv': return await importCSV(content, filename, key, provider);
    case 'url': return await importURL(url, key, provider);
    case 'text': return await importText(content, filename, key, provider);
    case 'json': return await importJSON(content, filename, key, provider);
    default: throw new Error(`Unknown type: ${type}. Available: pdf, word, excel, markdown, csv, url, text, json`);
  }
}

// ─── PDF ─────────────────────────────────────────────────────────────────────

async function importPDF(base64Content, filename, key, provider) {
  try {
    const pdfjsLib = await import('pdfjs-dist');
    const pdfData = new Uint8Array(Buffer.from(base64Content, 'base64'));
    const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
    
    let text = '';
    for (let i = 1; i <= Math.min(pdf.numPages, 50); i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(item => item.str).join(' ') + '\n\n';
    }
    
    await saveImport('pdf', filename, text);
    return { type: 'pdf', pages: pdf.numPages, characters: text.length, preview: text.slice(0, 500) };
  } catch (err) {
    return { error: `PDF import failed: ${err.message}` };
  }
}

// ─── Word (.docx) ────────────────────────────────────────────────────────────

async function importWord(base64Content, filename, key, provider) {
  try {
    const mammoth = await import('mammoth');
    const buffer = Buffer.from(base64Content, 'base64');
    const result = await mammoth.extractRawText({ buffer });
    
    await saveImport('word', filename, result.value);
    return { type: 'word', characters: result.value.length, preview: result.value.slice(0, 500) };
  } catch (err) {
    return { error: `Word import failed: ${err.message}` };
  }
}

// ─── Excel (.xlsx) ───────────────────────────────────────────────────────────

const MAX_EXCEL_BYTES = 20 * 1024 * 1024;

function cellText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(r => r.text).join('');
    if ('result' in v) return cellText(v.result);          // formula → the value it calculated
    if ('text' in v) return cellText(v.text);              // hyperlink
    if ('error' in v) return String(v.error);
    return '';
  }
  return String(v).replace(/[\t\r\n]+/g, ' ');
}

// .xlsx → text (columns separated by tabs) · uses exceljs rather than the older xlsx package (xlsx has a high-severity vulnerability with no fixed version) · .xlsx only
export async function excelBufferToText(buffer) {
  if (buffer.length > MAX_EXCEL_BYTES) throw new Error('The Excel file is larger than 20 MB');
  if (!(buffer.length > 3 && buffer[0] === 0x50 && buffer[1] === 0x4b)) throw new Error('Only .xlsx files are supported (the old .xls format is not — open it in Excel and save it as .xlsx)');
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheets = []; let text = '';
  for (const ws of wb.worksheets) {
    sheets.push(ws.name);
    const rows = [];
    ws.eachRow({ includeEmpty: false }, row => {
      const cells = [];
      for (let c = 1; c <= row.cellCount; c++) cells.push(cellText(row.getCell(c).value));
      rows.push(cells.join('\t'));
    });
    text += `=== ${ws.name} ===\n${rows.join('\n')}\n\n`;
  }
  return { text, sheets };
}

async function importExcel(base64Content, filename, key, provider) {
  try {
    const { text, sheets } = await excelBufferToText(Buffer.from(base64Content, 'base64'));
    await saveImport('excel', filename, text);
    return { type: 'excel', sheets, characters: text.length, preview: text.slice(0, 500) };
  } catch (err) {
    return { error: `Excel import failed: ${err.message}` };
  }
}

// ─── Markdown ────────────────────────────────────────────────────────────────

async function importMarkdown(content, filename, key, provider) {
  await saveImport('markdown', filename || 'untitled.md', content);
  return { type: 'markdown', characters: content.length, preview: content.slice(0, 500) };
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

async function importCSV(content, filename, key, provider) {
  await saveImport('csv', filename, content);
  return { type: 'csv', characters: content.length, preview: content.slice(0, 500) };
}

// ─── URL (fetch web page) ────────────────────────────────────────────────────

async function importURL(url, key, provider) {
  try {
    const page = await fetchPage(url);
    if (!page.ok) return { error: `Failed to fetch URL: ${page.error}` };
    await saveImport('url', url, page.text);
    return { type: 'url', url, title: page.title, characters: page.text.length, preview: page.text.slice(0, 500) };
  } catch (err) {
    return { error: `URL import failed: ${err.message}` };
  }
}

// ─── Plain Text ──────────────────────────────────────────────────────────────

async function importText(content, filename, key, provider) {
  await saveImport('text', filename || 'untitled.txt', content);
  return { type: 'text', characters: content.length, preview: content.slice(0, 500) };
}

// ─── JSON ────────────────────────────────────────────────────────────────────

async function importJSON(content, filename, key, provider) {
  try {
    const data = typeof content === 'string' ? JSON.parse(content) : content;
    const text = JSON.stringify(data, null, 2);
    await saveImport('json', filename, text);
    return { type: 'json', characters: text.length, preview: text.slice(0, 500) };
  } catch (err) {
    return { error: `JSON parse failed: ${err.message}` };
  }
}

// ─── Save Import ─────────────────────────────────────────────────────────────

async function saveImport(type, filename, content) {
  await ensureImportsDir();
  const timestamp = Date.now();
  const safeName = String(filename || 'untitled').replace(/[^a-zA-Z0-9_\-\.]/g, '_').slice(0, 50);
  const filepath = join(IMPORTS_DIR, `${timestamp}_${type}_${safeName}`);
  await writeFile(filepath, content, 'utf-8');
  return filepath;
}

// ─── List Imports ────────────────────────────────────────────────────────────

export async function listImports() {
  try {
    const files = await readdir(IMPORTS_DIR);
    return files.map(f => {
      const match = f.match(/^(\d+)_([a-z]+)_(.+)$/);
      return match ? { filename: f, timestamp: parseInt(match[1]), type: match[2], name: match[3] } : null;
    }).filter(Boolean);
  } catch {
    return [];
  }
}
