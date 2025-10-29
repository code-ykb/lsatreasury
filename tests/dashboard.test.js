const assert = require('assert');
const { bootstrapApp } = require('./helpers');

(function testDashboardIgnoresNonTransactionalCashflow() {
  const sandbox = bootstrapApp();
  const { syncTaggedArtifacts } = sandbox.window.__lsaTagged;
  const ensureCashflowIntegrity = sandbox.window.__lsaTxn.ensureCashflowIntegrity;

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const date = `${yyyy}-${mm}-${dd}`;

  const obRow = syncTaggedArtifacts(
    {
      id: 'ob-test',
      date,
      desc: 'OB — Operating Bank',
      debit: '1000',
      credit: '31010',
      amount: 900,
      fund: 'GEN',
    },
    'OB'
  );

  sandbox.localStorage.setItem('lsa_ob', JSON.stringify([obRow]));
  ensureCashflowIntegrity();

  const currentCashflow = JSON.parse(sandbox.localStorage.getItem('lsa_cashflow') || '[]');
  assert.ok(Array.isArray(currentCashflow), 'cashflow should be stored as an array');
  assert.ok(
    currentCashflow.some((row) => row && row._src === 'OB'),
    'opening balance entry should be tagged as OB'
  );

  const legacyEntry = {
    date,
    type: 'receipt',
    bucket: 'Legacy Receipt',
    amount: 400,
    fund: 'GEN',
    _src: 'LEGACY',
  };

  const transactionalEntry = {
    date,
    type: 'outgoing',
    bucket: 'Expense — General Fund — Test',
    amount: 250,
    fund: 'GEN',
    _src: 'PAYMENT',
  };

  sandbox.localStorage.setItem(
    'lsa_cashflow',
    JSON.stringify([...currentCashflow, legacyEntry, transactionalEntry])
  );

  const disallowedSources = new Set(['OB', 'ADJ']);
  const totals = JSON.parse(sandbox.localStorage.getItem('lsa_cashflow') || '[]').reduce(
    (acc, row) => {
      if (!row || !row.date) return acc;
      const source = typeof row._src === 'string' ? row._src.trim().toUpperCase() : '';
      if (source && disallowedSources.has(source)) return acc;
      const amt = Number(row.amount) || 0;
      if (row.type === 'receipt') acc.receipts += amt;
      else if (row.type === 'outgoing') acc.payments += amt;
      return acc;
    },
    { receipts: 0, payments: 0 }
  );

  assert.strictEqual(totals.receipts, 400, 'legacy receipts should be counted');
  assert.strictEqual(totals.payments, 250, 'transactional payments should be counted');
})();

console.log('All dashboard tests passed');
