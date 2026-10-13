/**
 * DRY RUN: Midasbuy login -> UID -> pack 99+109 -> BitCash -> PAY -> MyBitCash login form, then STOP.
 * Nothing is paid: no Bitcash credentials are typed, no OTP is requested.
 * (Pressing PAY only creates a pending order on Midasbuy.)
 */
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const { launch } = require('./bot/browser');
const midas = require('./bot/midasbuy');
const bitcash = require('./bot/bitcash');
const { log, makeRun, ask, sleep } = require('./utils/helpers');

(async () => {
  cfg.require('email', 'password', 'uid');
  const run = makeRun(cfg.artifactsDir);
  const summary = { startedAt: new Date().toISOString(), steps: [], ok: false };
  const ctx = await launch(cfg);
  const page = ctx.pages()[0] || (await ctx.newPage());
  let popup;

  const step = async (name, fn, shotPage = () => page) => {
    const t = Date.now();
    try {
      const r = await fn();
      summary.steps.push({ name, ok: true, ms: Date.now() - t });
      log(`OK   ${name}`);
      await run.shot(shotPage(), name);
      return r;
    } catch (e) {
      summary.steps.push({ name, ok: false, ms: Date.now() - t, code: e.code, error: e.message.split('\n')[0] });
      log(`FAIL ${name} [${e.code || 'ERROR'}] ${e.message.split('\n')[0]}`);
      await run.shot(shotPage(), name + '-FAIL');
      throw e;
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
    await sleep(4000); // reCAPTCHA frame loads late
    summary.recaptchaDetected = bitcash.hasRecaptcha(popup);
    summary.ok = true;
    log('DRY RUN COMPLETE. Stopped before entering MyBitCash credentials.');
  } catch (e) {
    summary.error = { code: e.code, message: e.message.split('\n')[0] };
  } finally {
    summary.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(run.dir, 'summary.json'), JSON.stringify(summary, null, 2));
    log('Artifacts: ' + run.dir);
    await ask('Press Enter to clean up (close Bitcash tab + pending order) and exit... ');
    try {
      if (popup && !popup.isClosed()) await popup.close();
      await midas.closePendingOrder(page);
    } catch {}
    await ctx.close();
  }
})();