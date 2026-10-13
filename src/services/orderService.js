const crypto = require('crypto');

class ApiError extends Error {
  constructor(http, code, message) { super(message); this.http = http; this.code = code; }
}

function createOrderService({ store, runner, packPriceJpy = 146, otpTimeoutMs = 10 * 60 * 1000 }) {
  let activeId = null;
  const otpWaiters = new Map();
  const now = () => new Date().toISOString();
  const update = (id, patch) => {
    const order = store.get(id);
    Object.assign(order, patch, { updatedAt: now() });
    store.save(order);
    return order;
  };
  const hooksFor = (id) => ({
    step: (name, ok, ms, err) => {
      const order = store.get(id);
      order.steps.push({ name, ok, ms, ...(err ? { code: err.code || 'ERROR', error: err.message.split('\n')[0] } : {}) });
      update(id, {});
    },
    setStatus: (status, patch = {}) => update(id, { status, ...patch }),
    waitForOtp: (ms = otpTimeoutMs) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        otpWaiters.delete(id);
        reject(Object.assign(new Error('OTP not received in time; no payment was submitted'), { code: 'OTP_TIMEOUT' }));
      }, ms);
      otpWaiters.set(id, { resolve, timer });
    }),
  });

  function create({ dryRun = true, confirm, idempotencyKey }) {
    if (idempotencyKey) {
      const duplicate = store.list().find((o) => o.idempotencyKey === idempotencyKey);
      if (duplicate) return { order: duplicate, replayed: true };
    }
    if (activeId) throw new ApiError(409, 'BUSY', `Order ${activeId} is still active`);
    const mode = dryRun ? 'dry-run' : 'real';
    if (mode === 'real') {
      if (confirm !== `PAY ${packPriceJpy}`) throw new ApiError(400, 'CONFIRM_REQUIRED', `Real payment needs confirm: "PAY ${packPriceJpy}"`);
      const all = store.list();
      if (all.some((o) => o.mode === 'real' && ['PAID', 'PAID_AMOUNT_MISMATCH'].includes(o.status)))
        throw new ApiError(409, 'ALREADY_PAID', 'A real payment has already completed for this account');
      const uncertain = all.find((o) => o.status === 'UNKNOWN_CHECK_MANUALLY');
      if (uncertain) throw new ApiError(409, 'UNRESOLVED_ORDER', `Check order ${uncertain.id} before another payment`);
    }
    const id = `ord_${crypto.randomBytes(6).toString('hex')}`;
    const order = { id, mode, status: 'QUEUED', amountJpy: packPriceJpy, idempotencyKey: idempotencyKey || null, createdAt: now(), updatedAt: now(), steps: [] };
    store.save(order);
    activeId = id;
    Promise.resolve().then(() => runner(order, hooksFor(id)))
      .catch((error) => update(id, { status: 'FAILED', error: { code: error.code || 'ERROR', message: String(error.message).split('\n')[0] } }))
      .finally(() => { activeId = null; });
    return { order: store.get(id), replayed: false };
  }

  function submitOtp(id, otp) {
    const order = store.get(id);
    if (!order) throw new ApiError(404, 'NOT_FOUND', 'Order not found');
    if (order.status !== 'AWAITING_OTP') throw new ApiError(409, 'NOT_AWAITING_OTP', `Order is ${order.status}`);
    if (!/^\d{6}$/.test(String(otp || ''))) throw new ApiError(400, 'BAD_OTP', 'OTP must contain exactly 6 digits');
    const waiter = otpWaiters.get(id);
    if (!waiter) throw new ApiError(409, 'NOT_AWAITING_OTP', 'No OTP is currently awaited');
    clearTimeout(waiter.timer); otpWaiters.delete(id); waiter.resolve(String(otp));
    return store.get(id);
  }

  function resolve(id, resolution) {
    const order = store.get(id);
    if (!order) throw new ApiError(404, 'NOT_FOUND', 'Order not found');
    if (order.status !== 'UNKNOWN_CHECK_MANUALLY') throw new ApiError(409, 'NOT_UNKNOWN', `Order is ${order.status}`);
    if (!['not_charged', 'charged'].includes(resolution)) throw new ApiError(400, 'BAD_RESOLUTION', 'resolution must be "not_charged" or "charged"');
    return update(id, { status: resolution === 'charged' ? 'PAID_AMOUNT_MISMATCH' : 'FAILED', resolvedManually: resolution });
  }

  function balance() {
    const readings = store.list().filter((o) => o.result && o.result.balance != null)
      .sort((a, b) => (a.result.receivedAt || a.createdAt).localeCompare(b.result.receivedAt || b.createdAt));
    if (!readings.length) throw new ApiError(404, 'NO_PAYMENT_YET', 'No saved completion-page balance is available');
    const last = readings.at(-1); const previous = readings.at(-2);
    const checks = { amountMatchesPack: last.result.paidAmount === packPriceJpy };
    if (previous) checks.reconciles = previous.result.balance - last.result.paidAmount === last.result.balance;
    return { balance: last.result.balance, unit: 'credit', asOf: last.result.receivedAt, invoiceNo: last.result.invoiceNo, transactionNo: last.result.transactionNo, orderId: last.id, checks, consistent: Object.values(checks).every(Boolean) };
  }
  return { create, submitOtp, resolve, balance, get: (id) => store.get(id), list: () => store.list() };
}
module.exports = { createOrderService, ApiError };
