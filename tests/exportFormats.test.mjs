import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownToHtml, articleDigest, generateWebsiteHTML, exportMultiFormat } from '../src/skills/exportFormats.mjs';

test('markdownToHtml escapes HTML from the content and only links http(s) addresses', () => {
  const html = markdownToHtml('## A <script>alert(1)</script> title\n\nSee [the report](https://example.com/a?b=1&c=2) and [bad](javascript:alert(1)) and **bold** text <img src=x onerror=alert(1)>');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('<a href="https://example.com/a?b=1&amp;c=2" rel="noopener noreferrer">the report</a>'));
  assert.ok(!html.includes('href="javascript:'), 'javascript: links are never made');
  assert.ok(html.includes('<strong>bold</strong>'));
  assert.ok(html.includes('<h3>'));
});

test('markdownToHtml makes lists, rules and paragraphs', () => {
  const html = markdownToHtml('First paragraph\nsecond line\n\n---\n\n1. One\n2. Two\n\n- A\n- B');
  assert.ok(html.includes('<p>First paragraph<br>second line</p>'));
  assert.ok(html.includes('<hr>'));
  assert.ok(html.includes('<ol>') && html.includes('<li>Two</li>'));
  assert.ok(html.includes('<ul>') && html.includes('<li>B</li>'));
});

const job = {
  id: 'OBA-00000000', topic: 'Topic', language: 'en',
  stages: { channels: { result: { blockdit: { title: 'The <title>', deck: 'Deck & more', body: '## Heading\n\nA fact [1][2] told here.\n\n---\n\n*Checked on 2026-10-01*\n\n**Sources:**\n1. [A](https://a.example)' } } } }
};

test('articleDigest gives the model the text without reference numbers, the footer or the Sources list', () => {
  const d = articleDigest(job);
  assert.ok(d.startsWith('The <title>\nDeck & more'));
  assert.ok(d.includes('A fact told here.'));
  assert.ok(!d.includes('[1]') && !d.includes('Sources') && !d.includes('Checked on'));
  assert.equal(articleDigest({ stages: {} }), '');
});

test('the generated HTML page escapes the title and standfirst', async () => {
  const html = await generateWebsiteHTML(job);
  assert.ok(html.includes('<title>The &lt;title&gt;</title>'));
  assert.ok(html.includes('Deck &amp; more'));
  assert.ok(html.includes('<html lang="en">'));
});

test('exportMultiFormat refuses an id that is not a job id and reports unknown formats', async () => {
  await assert.rejects(() => exportMultiFormat('../../etc', ['social'], 'k'), /Invalid job id/);
});
