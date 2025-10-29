const assert = require('assert');
const { bootstrapApp, getJSON } = require('./helpers');

(function testCascadeDeleteCleansArtifacts() {
  const sandbox = bootstrapApp();
  sandbox.ensureSeedDataStrict();

  const tag = 'TXN-test';
  const journalRow = {
    date: '2024-01-01',
    fund: 'GEN',
    desc: 'Direct Contribution — General Fund',
    debit: '11010',
    credit: '41010',
    amount: 1500,
    _tag: tag,
    _src: 'TEST',
  };
  const cashflowRow = {
    date: '2024-01-01',
    type: 'receipt',
    bucket: 'Direct Contribution — General Fund',
    amount: 1500,
    fund: 'GEN',
    note: 'Direct Contribution — General Fund',
  };
  const txnRow = { id: tag, amount: 1500, date: '2024-01-01', category: 'contribution' };

  sandbox.localStorage.setItem('lsa_journal', JSON.stringify([journalRow]));
  sandbox.localStorage.setItem('lsa_cashflow', JSON.stringify([cashflowRow]));
  sandbox.localStorage.setItem('lsa_transactions', JSON.stringify([txnRow]));

  let refreshCalls = 0;
  sandbox.window.__lsaDash = {
    refresh() {
      refreshCalls += 1;
    },
  };

  const txnApi = sandbox.window.__lsaTxn;
  assert.ok(txnApi, 'transaction helpers should be exposed on window.__lsaTxn');
  txnApi.ensureCashflowIntegrity();

  let cf = getJSON(sandbox.localStorage, 'lsa_cashflow');
  assert.ok(Array.isArray(cf), 'cashflow rows should be stored as an array');
  assert.strictEqual(cf.length, 1, 'expected one cashflow row before deletion');
  assert.strictEqual(cf[0]._tag, tag, 'cashflow row should inherit the transaction tag');

  refreshCalls = 0;
  const result = txnApi.purgeTransactionArtifacts(tag);
  assert.ok(result && result.removed, 'purge should report that rows were removed');

  cf = getJSON(sandbox.localStorage, 'lsa_cashflow');
  const journal = getJSON(sandbox.localStorage, 'lsa_journal');
  const txns = getJSON(sandbox.localStorage, 'lsa_transactions');

  assert.strictEqual(cf.length, 0, 'cashflow rows should be removed for the tag');
  assert.strictEqual(journal.length, 0, 'journal rows should be removed for the tag');
  assert.strictEqual(txns.length, 0, 'transaction log entry should be removed for the tag');
  assert.ok(refreshCalls > 0, 'dashboard refresh hook should fire when cashflow changes');
})();

(function testCascadeDeleteCleansUntaggedCashflow() {
  const sandbox = bootstrapApp();
  sandbox.ensureSeedDataStrict();

  const tag = 'TXN-legacy';
  const journalRow = {
    date: '2024-02-02',
    fund: 'GEN',
    desc: 'Direct Contribution — General Fund',
    debit: '11010',
    credit: '41010',
    amount: 2500,
    _tag: tag,
    _src: 'CONTRIB',
  };
  const cashflowRow = {
    date: '2024-02-02',
    type: 'receipt',
    bucket: 'Direct Contribution — General Fund',
    amount: 2500,
    fund: 'GEN',
    note: 'Direct Contribution — General Fund',
  };
  const txnRow = {
    id: tag,
    amount: 2500,
    date: '2024-02-02',
    category: 'contribution',
    direction: 'in',
    description: 'Direct Contribution — General Fund',
  };

  sandbox.localStorage.setItem('lsa_journal', JSON.stringify([journalRow]));
  sandbox.localStorage.setItem('lsa_cashflow', JSON.stringify([cashflowRow]));
  sandbox.localStorage.setItem('lsa_transactions', JSON.stringify([txnRow]));

  let refreshCalls = 0;
  sandbox.window.__lsaDash = {
    refresh() {
      refreshCalls += 1;
    },
  };

  const txnApi = sandbox.window.__lsaTxn;
  txnApi.ensureCashflowIntegrity();

  let cf = getJSON(sandbox.localStorage, 'lsa_cashflow');
  assert.strictEqual(cf.length, 1, 'setup should store one untagged cashflow row');

  refreshCalls = 0;
  const result = txnApi.purgeTransactionArtifacts(tag);
  assert.ok(result && result.removed, 'purge should report removal when untagged cashflow matches journal');

  cf = getJSON(sandbox.localStorage, 'lsa_cashflow');
  const journal = getJSON(sandbox.localStorage, 'lsa_journal');
  const txns = getJSON(sandbox.localStorage, 'lsa_transactions');

  assert.strictEqual(cf.length, 0, 'fallback matcher should remove untagged cashflow rows for the tag');
  assert.strictEqual(journal.length, 0, 'journal rows should be removed for the tag');
  assert.strictEqual(txns.length, 0, 'transaction record should be removed for the tag');
  assert.ok(refreshCalls > 0, 'dashboard refresh hook should fire when fallback removal saves cashflow');
})();

(function testEnsureIntegrityDropsOrphanCashflowRows() {
  const sandbox = bootstrapApp();
  sandbox.ensureSeedDataStrict();

  const orphanRow = {
    date: '2024-03-03',
    type: 'receipt',
    bucket: 'Direct Contribution — General Fund',
    amount: 9000,
    fund: 'GEN',
    note: 'Direct Contribution — General Fund',
    _tag: 'TXN-orphan',
    _src: 'CONTRIB',
  };

  sandbox.localStorage.setItem('lsa_cashflow', JSON.stringify([orphanRow]));

  const txnApi = sandbox.window.__lsaTxn;
  assert.ok(txnApi, 'transaction helpers should be available for integrity checks');

  txnApi.ensureCashflowIntegrity();

  const cf = getJSON(sandbox.localStorage, 'lsa_cashflow');
  assert.ok(Array.isArray(cf), 'cashflow rows should persist as an array');
  assert.strictEqual(cf.length, 0, 'ensureCashflowIntegrity should purge cashflow rows with no journal backing');
})();

console.log('All delete tests passed');
