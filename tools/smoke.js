const assert = require('assert');
const os = require('os');
const path = require('path');
process.env.MIDAS_EMAIL = process.env.MIDAS_EMAIL || 'test@example.com';
const { createApp } = require('../src/server');
const { createStore } = require('../src/services/orderStore');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const runner = async (order, hooks) => {
  hooks.setStatus('RUNNING'); hooks.step('open', true, 1);
  if (order.mode === 'dry-run') return hooks.setStatus('DRY_RUN_OK');
  hooks.setStatus('AWAITING_OTP'); await hooks.waitForOtp(2000);
  hooks.setStatus('PAID', { result: { invoiceNo: 'INV_TEST', paidAmount: 146, balance: 25000, receivedAt: '2026-10-13T12:00:00Z' } });
};
(async () => {
  const store = createStore(path.join(os.tmpdir(), `bitcash-orders-${Date.now()}.json`));
  const server = createApp({ runner, store }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body, headers = {}) => { const response = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...headers }, body: body && JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  try {
    let result = await call('POST', '/orders', {}); assert.equal(result.status, 202); await wait(30);
    assert.equal((await call('GET', `/orders/${result.body.id}`)).body.status, 'DRY_RUN_OK');
    result = await call('POST', '/orders', { dryRun: false }); assert.equal(result.body.error.code, 'CONFIRM_REQUIRED');
    result = await call('POST', '/orders', { dryRun: false, confirm: 'PAY 146' }, { 'Idempotency-Key': 'smoke-real' }); const id = result.body.id;
    assert.equal((await call('POST', '/orders', { dryRun: false, confirm: 'PAY 146' }, { 'Idempotency-Key': 'smoke-real' })).status, 200);
    await wait(30); assert.equal((await call('POST', `/orders/${id}/otp`, { otp: '12' })).body.error.code, 'BAD_OTP');
    assert.equal((await call('POST', `/orders/${id}/otp`, { otp: '123456' })).status, 200); await wait(30);
    assert.equal((await call('GET', '/balance')).body.balance, 25000);
    console.log('smoke test passed');
  } finally { server.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
