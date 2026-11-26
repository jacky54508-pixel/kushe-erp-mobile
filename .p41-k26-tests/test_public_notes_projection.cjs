'use strict';

// Data-boundary and escaped-markup checks, not a substitute for browser/PDF QA.
// CI reads its reference source from the exact released commit. Local review
// may pass --baseline-root, whose two input blobs are checked against that pin.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const vm = require('node:vm');

const BASELINE = '668334605342e5766027c3f73b4fe1b29036dec0';
const BASELINE_BLOBS = {
  'assets/js/billing-print.js': 'd2e7b9dd3eadc749893be983caf6a91cece898d2',
  'billing-print.html': 'adfe1cf27eb71122a6ddcc49de8ebec62ed64d9e',
};
const options = { root: process.cwd() };
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index];
  if (!['--root', '--baseline-root', '--output'].includes(name) || !process.argv[index + 1]) {
    throw new Error('Usage: node test_public_notes_projection.cjs --root REPO [--baseline-root BASELINE_COPY] [--output RESULT.json]');
  }
  options[name.slice(2)] = path.resolve(process.argv[index + 1]);
}
options.root = path.resolve(options.root);

const report = { schema: 'p41-k26-public-note-projection-v1', baselineCommit: BASELINE,
  scope: 'Synthetic data projection, financial invariance, privacy, escaped row markup and export routing; no browser or business writes',
  checks: [], status: 'RUNNING' };
function check(name, action) {
  try { action(); report.checks.push({ name, passed: true }); }
  catch (error) { report.checks.push({ name, passed: false, error: error.message }); }
}
function gitBlob(bytes) {
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
}
function baselineFile(file) {
  const bytes = options['baseline-root'] ? fs.readFileSync(path.join(options['baseline-root'], file)) :
    execFileSync('git', ['-C', options.root, 'show', `${BASELINE}:${file}`]);
  assert.equal(gitBlob(bytes), BASELINE_BLOBS[file], `Released baseline blob mismatch: ${file}`);
  return bytes.toString('utf8');
}
function normal(value) { return JSON.parse(JSON.stringify(value)); }
function loadProjection(source) {
  const assignedUrls = [];
  const window = {
    KuSheERPStore: { getState: () => ({ settings: {} }) },
    KusheDisplaySort: { sortWorkRows: rows => rows },
  };
  const location = { href: 'https://example.invalid/erp/index.html', assign: url => assignedUrls.push(url) };
  vm.runInNewContext(source, { window, location, URL, btoa: value => Buffer.from(value, 'binary').toString('base64'),
    unescape, encodeURIComponent }, { filename: 'assets/js/billing-print.js' });
  return { window, assignedUrls };
}
function record(mode) {
  return {
    id: 'SYN-K26-QUOTE', pricingMode: mode, date: '2026-11-27', projectName: 'SYN-K26-PROJECT',
    amount: 15000, tax: 750, total: 15750, publicNote: 'SYN public document note', internalNote: 'SYN PRIVATE DOCUMENT',
    lines: [
      { item: 'SYN item A', unit: '戶', qty: 1, price: 15000, amount: 15000, lumpSumAmount: 15000,
        pricingType: 'actual', note: '  不含拋光磚.全室地壁磚.全室門檻.車庫地磚\nSYN <script> x & y  ', internalNote: 'SYN PRIVATE LINE' },
      { item: 'SYN item B', unit: '式', qty: 1, price: 500, lumpSumAmount: 500,
        pricingType: 'lump_sum', note: '備用單價', privateNote: 'SYN PRIVATE OTHER' },
      { item: 'SYN item C', unit: '式', qty: 1, price: 300, note: '' },
    ],
  };
}

try {
  const before = loadProjection(baselineFile('assets/js/billing-print.js'));
  const after = loadProjection(fs.readFileSync(path.join(options.root, 'assets/js/billing-print.js'), 'utf8'));
  baselineFile('billing-print.html');
  for (const mode of ['actual', 'lump_sum', 'mixed']) {
    const source = record(mode), snapshot = JSON.stringify(source);
    const oldView = normal(before.window.KusheQuotationPrint.buildExternalView(source));
    const newView = normal(after.window.KusheQuotationPrint.buildExternalView(source));
    check(`${mode}: public work-scope text and internal newline survive projection`, () => {
      assert.equal(newView.lines[0].note, source.lines[0].note.trim());
    });
    check(`${mode}: backup-price public note survives projection`, () => assert.equal(newView.lines[1].note, '備用單價'));
    check(`${mode}: absent public note remains empty`, () => assert.equal(newView.lines[2].note, ''));
    check(`${mode}: every pre-existing public value is unchanged`, () => {
      const stripped = normal(newView);
      for (const line of stripped.lines) delete line.note;
      assert.deepEqual(stripped, oldView);
    });
    check(`${mode}: document and per-line internal fields stay private`, () => {
      assert(!JSON.stringify(newView).includes('SYN PRIVATE'));
    });
    check(`${mode}: billing public projection stays exactly unchanged`, () => {
      assert.deepEqual(normal(after.window.KusheBillingPrint.buildExternalView(source)),
        normal(before.window.KusheBillingPrint.buildExternalView(source)));
    });
    check(`${mode}: export projection does not mutate the input record`, () => assert.equal(JSON.stringify(source), snapshot));
  }

  // Execute the production row renderer with its production esc/number helpers.
  // Actual browser tests separately check DOM measurement, CSS and PDF text.
  const html = fs.readFileSync(path.join(options.root, 'billing-print.html'), 'utf8');
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1])
    .find(script => script.includes('const quoteRows='));
  assert(inline, 'Production inline quotation renderer not found');
  const helpersEnd = inline.indexOf('    function closePrintView(');
  const rowsStart = inline.indexOf('    const quoteLineNote=');
  const rowsEnd = inline.indexOf('    // PDF display grouping only:');
  assert(helpersEnd > 0 && rowsStart > helpersEnd && rowsEnd > rowsStart, 'Production renderer extraction boundaries changed');
  const renderer = inline.slice(0, helpersEnd) + inline.slice(rowsStart, rowsEnd) + '\n;globalThis.result=quoteRows;';
  function renderRows(lines, isActual) {
    const context = { lines, isActual };
    vm.runInNewContext(renderer, context, { filename: 'billing-print.html quotation row renderer' });
    return context.result;
  }
  for (const actual of [true, false]) {
    const row = { item: 'SYN', unit: '戶', qty: 1, price: 15000, amount: 15000, pricingType: 'actual',
      note: '<img src=x onerror="alert(1)">\n & detail', internalNote: 'PRIVATE' };
    const rendered = renderRows([row], actual), label = actual ? 'actual renderer' : 'total/mixed renderer';
    check(`${label}: public HTML characters are escaped`, () => assert(rendered.includes('&lt;img')));
    check(`${label}: public text cannot inject an image element`, () => assert(!rendered.includes('<img')));
    check(`${label}: embedded newline and escaped ampersand survive`, () => assert(rendered.includes('\n &amp; detail')));
    check(`${label}: private row note is never rendered`, () => assert(!rendered.includes('PRIVATE')));
  }
  check('actual renderer: backup-price note appears exactly once', () => {
    const rendered = renderRows([{ item: 'SYN', qty: 1, price: 500, note: '備用單價', isBackupPrice: true }], true);
    assert.equal((rendered.match(/備用單價/g) || []).length, 1);
  });
  check('actual renderer: whitespace-only note adds no empty public-note block', () => {
    const rendered = renderRows([{ item: 'SYN', qty: 1, price: 500, note: ' \n\t ' }], true);
    assert(!rendered.includes('p41-quote-line-note'));
  });

  for (const action of ['print', 'export']) {
    const source = record('actual');
    after.window.KusheQuotationPrint[action](source);
    const quoteUrl = new URL(after.assignedUrls.at(-1));
    check(`quotation ${action}: new print template cache version and requested print mode`, () => {
      assert.equal(quoteUrl.searchParams.get('v'), 'p41-k26-quote-notes-20261127-1');
      assert.equal(quoteUrl.searchParams.get('print'), action === 'export' ? '1' : '0');
    });
    check(`quotation ${action}: public notes survive the actual URL payload without private fields`, () => {
      const payload = JSON.parse(Buffer.from(decodeURIComponent(quoteUrl.hash.slice(1)), 'base64').toString('utf8'));
      assert.equal(payload.lines[0].note, source.lines[0].note.trim());
      assert.equal(payload.publicNote, source.publicNote);
      assert(!JSON.stringify(payload).includes('SYN PRIVATE'));
    });
    before.window.KusheBillingPrint[action](source);
    after.window.KusheBillingPrint[action](source);
    check(`billing ${action}: complete navigation URL remains identical to released source`, () => {
      assert.equal(after.assignedUrls.at(-1), before.assignedUrls.at(-1));
    });
  }
} catch (error) {
  report.checks.push({ name: 'test setup and complete execution', passed: false, error: error.stack || error.message });
}
report.passed = report.checks.filter(check => check.passed).length;
report.failed = report.checks.filter(check => !check.passed).length;
report.status = report.failed ? 'FAIL' : 'PASS';
if (options.output) {
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, JSON.stringify(report, null, 2) + '\n');
}
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
process.exitCode = report.failed ? 1 : 0;
