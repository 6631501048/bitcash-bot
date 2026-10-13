const path = require('path');
const cfg = require('./config');
const { launch } = require('./bot/browser');
const midas = require('./bot/midasbuy');
const bitcash = require('./bot/bitcash');
const { fillOtp, readExpiry } = require('./bot/otp');
const { waitForResult } = require('./bot/result');
const { makeRun, sleep, log } = require('./utils/helpers');

/** Browser flow used by the API. A real order pauses until POST /orders/:id/otp arrives. */
async function runFlow(order, hooks) {
  const real = order.mode === 'real';
  cfg.require('email', 'password', 'uid');
  if (real) cfg.require('bitcashId', 'bitcashPassword');
  const run = makeRun(path.join(cfg.artifactsDir, order.id));
  hooks.setStatus('RUNNING', { artifactsDir: run.dir });
  const context = await launch(cfg);
  const page = context.pages()[0] || await context.newPage();
  let popup; let otpSubmitted = false;
  const step = async (name, action, screenshotPage = () => page) => {
    const started = Date.now();
    try {
      const value = await action(); hooks.step(name, true, Date.now() - started); await run.shot(screenshotPage(), name); return value;
    } catch (error) {
      hooks.step(name, false, Date.now() - started, error); await run.shot(screenshotPage(), `${name}-FAIL`); throw error;
    }
  };
  try {
    await step('open', () => midas.open(page, cfg));
    await step('login', () => midas.login(page, cfg));
    await step('dismiss-popups', () => midas.dismissPopups(page));
    await step('ensure-uid', () => midas.ensureUid(page, cfg));
    await step('select-pack', () => midas.selectPack(page, cfg));
    popup = await step('pay-with-bitcash', () => midas.payWithBitcash(page, cfg));
    await step('bitcash-login-form', () => bitcash.toLoginForm(popup, cfg), () => popup);
    if (!real) {
      await sleep(3000);
      hooks.setStatus('DRY_RUN_OK', { recaptchaDetected: bitcash.hasRecaptcha(popup) });
      return;
    }
    await step('bitcash-login', () => bitcash.login(popup, cfg), () => popup);
    const expiry = await readExpiry(popup);
    hooks.setStatus('AWAITING_OTP', { otpExpiresAtThai: expiry?.ict, otpMinutesLeft: expiry?.minutesLeft });
    const otp = await hooks.waitForOtp();
    hooks.setStatus('VERIFYING'); otpSubmitted = true;
    await step('otp', () => fillOtp(popup, otp, { manualAssist: false }), () => popup);
    const result = await waitForResult(popup, run.dir, cfg.packPriceJpy);
    await midas.refreshResult(page).catch(() => {});
    hooks.setStatus(result.amountOk ? 'PAID' : 'PAID_AMOUNT_MISMATCH', { result });
  } catch (error) {
    const details = { code: error.code || 'ERROR', message: error.message.split('\n')[0] };
    hooks.setStatus(otpSubmitted ? 'UNKNOWN_CHECK_MANUALLY' : 'FAILED', { error: details });
  } finally {
    try {
      if (popup && !popup.isClosed()) await popup.close();
      if (order.mode === 'dry-run' || !otpSubmitted) await midas.closePendingOrder(page);
    } catch {}
    await context.close().catch(() => {});
    log(`order ${order.id} finished`);
  }
}
module.exports = { runFlow };
