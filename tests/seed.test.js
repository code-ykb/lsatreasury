const assert = require('assert');
const { bootstrapApp, getJSON } = require('./helpers');

(function testSeedsReserveAccount() {
  const sandbox = bootstrapApp();
  sandbox.ensureSeedDataStrict();

  const funds = getJSON(sandbox.localStorage, 'lsa_funds');
  assert.ok(Array.isArray(funds), 'funds should be stored as an array');
  assert.strictEqual(funds.length, 9, 'should seed all default funds');

  const reserve = funds.find((f) => f.code === 'RES');
  assert.ok(reserve, 'Reserve Account should be seeded');
  assert.strictEqual(reserve.name, 'Reserve Account', 'Reserve Account should keep its name');

  const coa = getJSON(sandbox.localStorage, 'lsa_coa');
  assert.ok(Array.isArray(coa), 'chart of accounts should be stored as an array');
  const reserveAccounts = coa.filter((a) => a.fund === 'RES');
  assert.strictEqual(reserveAccounts.length, 4, 'Reserve Account should have four ledger entries');
  reserveAccounts.forEach((acct) => {
    assert.ok(!acct.name.endsWith(' Fund'), 'Reserve Account ledgers must not end with "Fund"');
  });
})();

(function testBackfillsMissingReserve() {
  const sandbox = bootstrapApp();
  sandbox.ensureSeedDataStrict();

  // Simulate a dataset missing the Reserve Account after the fact.
  const funds = getJSON(sandbox.localStorage, 'lsa_funds').filter((f) => f.code !== 'RES');
  sandbox.localStorage.setItem('lsa_funds', JSON.stringify(funds));

  const coa = getJSON(sandbox.localStorage, 'lsa_coa').filter((acct) => acct.fund !== 'RES');
  sandbox.localStorage.setItem('lsa_coa', JSON.stringify(coa));

  sandbox.ensureSeedDataStrict();

  const updatedFunds = getJSON(sandbox.localStorage, 'lsa_funds');
  assert.strictEqual(updatedFunds.length, 9, 'backfill should restore missing Reserve Account');
  const reserve = updatedFunds.find((f) => f.code === 'RES');
  assert.ok(reserve, 'Reserve Account should be restored');
  assert.strictEqual(reserve.name, 'Reserve Account', 'Reserve Account name should remain unchanged');

  const updatedCoa = getJSON(sandbox.localStorage, 'lsa_coa');
  const reserveAccounts = updatedCoa.filter((acct) => acct.fund === 'RES');
  assert.strictEqual(reserveAccounts.length, 4, 'Reserve Account ledgers should be regenerated when missing');
})();

(function testDoesNotDuplicateAccounts() {
  const sandbox = bootstrapApp();
  sandbox.ensureSeedDataStrict();
  sandbox.ensureSeedDataStrict();

  const coa = getJSON(sandbox.localStorage, 'lsa_coa');
  const codes = new Set();
  coa.forEach((acct) => {
    assert.ok(!codes.has(acct.code), `account code ${acct.code} should not be duplicated`);
    codes.add(acct.code);
  });
})();

console.log('All seed tests passed');
