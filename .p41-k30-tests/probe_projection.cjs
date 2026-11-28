'use strict';
// Supplemental exact-source readonly checks. NEVER browser/persistence/writer proof.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const child = require('node:child_process');
const assert = require('node:assert/strict');
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const root = path.resolve(option('--root', path.resolve(__dirname, '..')));
const source = fs.readFileSync(option('--store', path.join(root, 'assets/js/erp-store.js')), 'utf8');
const python = option('--python', process.env.PYTHON || 'python');
const fixtures = JSON.parse(child.execFileSync(python, ['-c', `import json,sys;sys.path.insert(0,${JSON.stringify(path.join(root, '.p41-k30-tests'))});from k30_fixture import fixture,allowance_input,ORIGINALS;print(json.dumps({'states':{k:fixture(k) for k in ('standard','issued','legacy-received','linked-commission','duplicate-ar','conflicting-alias')},'inputs':{'single':allowance_input(),'issued':allowance_input(issued=True),'noInvoice':allowance_input(index=2)},'originals':ORIGINALS}))`], {encoding: 'utf8'}));
const report = {schema: 'k30-readonly-projection-v1', browserTest: false, persistenceTest: false,
  writerTest: false, productionDataTouched: false, sourceSha256: crypto.createHash('sha256').update(source).digest('hex'), checks: [], failures: []};
const normalize = value => JSON.parse(JSON.stringify(value));
function check(name, body) {
  try { body(); report.checks.push({name, passed: true}); }
  catch (error) { report.checks.push({name, passed: false}); report.failures.push({name, message: error.message, stack: error.stack}); }
}
async function load(data) {
  assert.equal(data.meta.k30Synthetic, true);
  assert(data.billings.every(row => row.id.startsWith('SYN-K30-')));
  const values = new Map();
  const storage = {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key), get length() { return values.size; }};
  const sandbox = {console, Intl, Date, JSON, Math, Number, Boolean, String, Array, Object, Map, Set, WeakSet,
    Promise, RegExp, Error, TypeError, Blob, TextEncoder, TextDecoder, URL, structuredClone, crypto: crypto.webcrypto,
    setTimeout, clearTimeout, localStorage: storage, sessionStorage: storage, navigator: {}, location: {hostname: '127.0.0.1'},
    dispatchEvent() {}, addEventListener() {}, removeEventListener() {},
    CustomEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    KUSHE_PHASE1_CONFIG: {},
    KusheAuthGate: {session: () => ({access_token: 'SYN-K30-LOCAL-ONLY'}), user: () => ({id: 'SYN-K30-OWNER'}),
      companyContext: () => ({userId: 'SYN-K30-OWNER', companyId: 'SYN-K30-COMPANY', role: 'owner', status: 'active', shadowVerified: true})},
    KusheCloudSync: {billingAllowanceWriteReadiness: () => ({ready: true, capability: 'billing-allowances-v2', reason: 'SYN-K30 isolated capability fixture'})}};
  sandbox.window = sandbox;
  vm.runInContext(source, vm.createContext(sandbox), {timeout: 5000, filename: 'exact-candidate-erp-store.js'});
  const store = sandbox.KuSheERPStore;
  await store.loadEphemeralSnapshot(data, {userId: 'SYN-K30-OWNER', syncVersion: 1});
  return store;
}
(async () => {
  for (const kind of ['standard', 'issued', 'legacy-received']) {
    const store = await load(fixtures.states[kind]), before = JSON.stringify(store.getState());
    check(kind + ': independent original amount and settlement oracle', () => {
      const a = normalize(store.billingFinancialState('SYN-K30-BILL-A'));
      assert.equal(a.valid, true, JSON.stringify(a));
      assert.deepEqual(a.original, fixtures.originals[0]);
      assert.deepEqual(a.effective, fixtures.originals[0]);
      assert.equal(a.settlement.received, kind === 'legacy-received' ? 41000 : 40000);
      assert.equal(a.settlement.retentionOutstanding, 5000);
      assert.deepEqual(normalize(store.receivableFinancialState('SYN-K30-BILL-A-AR')).settlement, a.settlement);
    });
    check(kind + ': clean-source formal preview uses exact supplied reductions', () => {
      const result = normalize(store.billingAllowancePreview(fixtures.inputs[kind === 'issued' ? 'issued' : 'single']));
      assert.equal(result.allowed, true, JSON.stringify(result));
      assert.deepEqual(result.sourceRows[0].after, {untaxed: 90000, tax: 4500, grossTotal: 94500, retention: 4500, receivable: 90000});
      assert.equal(result.totals.reductions.grossTotal, 10500);
      assert.equal(result.sourceRows.length, 1);
      assert(result.snapshot);
    });
    check(kind + ': no-invoice source has no fabricated tax adjustment', () => {
      const result = normalize(store.billingAllowancePreview(fixtures.inputs.noInvoice));
      assert.equal(result.allowed, true, JSON.stringify(result));
      assert.deepEqual(result.sourceRows[0].after, {untaxed: 18000, tax: 0, grossTotal: 18000, retention: 1800, receivable: 16200});
    });
    check(kind + ': all actual readonly calls preserve the entire published snapshot', () => assert.equal(JSON.stringify(store.getState()), before));
  }
  for (const kind of ['linked-commission', 'duplicate-ar', 'conflicting-alias']) {
    const store = await load(fixtures.states[kind]), before = JSON.stringify(store.getState());
    check(kind + ': unsafe source fails preview without mutations', () => {
      const result = store.billingAllowancePreview(fixtures.inputs.single);
      assert.equal(result.allowed, false, JSON.stringify(result));
      assert(result.blockers.length);
      if (kind === 'linked-commission') assert(result.blockers.some(row => row.code === 'COMMISSION_POLICY_REVIEW'));
      assert.equal(JSON.stringify(store.getState()), before);
    });
  }
  report.passed = report.failures.length === 0;
  const destination = option('--output', '');
  if (destination) { fs.mkdirSync(path.dirname(destination), {recursive: true}); fs.writeFileSync(destination, JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
