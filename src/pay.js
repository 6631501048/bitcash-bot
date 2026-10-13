/**
 * REAL PAYMENT (one shot: the pack is limited to 1 per account).
 *   npm run pay -- --confirm-real-payment
 * Same flow as dry-run, then: MyBitCash login -> OTP -> completion page -> invoice/amount/balance.
 * Run only inside 12:00-17:00 while HR is available to give the OTP.
 * Never retried automatically: after OTP is entered, check Order Center before trying again.
 */
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const { launch } = require('./bot/browser');
const midas = require('./bot/midasbuy');
const bitcash = require('./bot/bitcash');
const { getOtp, fillOtp } = require('./bot/otp');
const { waitForResult } = require('./bot/result');
const { log, makeRun, ask } = require('./utils/helpers');

(async () => {
  // Accepted in 3 forms because PowerShell swallows "--" and npm then eats the flag:
  //   node src/pay.js --confirm-real-payment
  //   npm run pay --confirm-real-payment   (npm exposes it as npm_config_confirm_real_payment)
  //   CONFIRM_REAL_PAYMENT=true            (env var)
  const confirmed =
    process.argv.includes('--confirm-real-payment') ||
    process.env.npm_config_confirm_real_payment === 'true' ||
    process.env.CONFIRM_REAL_PAYMENT === 'true';
  if (!confirmed) {
    console.error('Refusing to run: this spends real money.');
    console.error('Re-run with:  node src/pay.js --confirm-real-payment');
    process.exit(1);
  }
  cfg.require('email', 'password', 'uid', 'bitcashId', 'bitcashPassword');

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

    // Last gate before money can move
    const go = await ask(`\nAbout to log in to MyBitCash and pay ${cfg.packPriceJpy} JPY. Type "PAY ${cfg.packPriceJpy}" to continue: `);
    if (go.trim() !== `PAY ${cfg.packPriceJpy}`) throw Object.assign(new Error('Aborted by user'), { code: 'ABORTED' });

    await step('bitcash-login', () => bitcash.login(popup, cfg), () => popup);
    const otp = await getOtp();
    await step('otp', () => fillOtp(popup, otp, { manualAssist: cfg.manualAssist }), () => popup);

    const result = await waitForResult(popup, run.dir, cfg.packPriceJpy);
    summary.result = result;
    summary.ok = result.amountOk;
    if (!result.amountOk) log(`WARNING: paid ${result.paidAmount}, expected ${cfg.packPriceJpy}. Investigate before anything else.`);

    // Shop side: "Payment is in progress" -> Refresh Result (best effort, logged only)
    await midas.refreshResult(page).catch(() => {});
    await run.shot(page, 'midasbuy-after-payment');
  } catch (e) {
    summary.error = { code: e.code, message: e.message.split('\n')[0] };
  } finally {
    summary.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(run.dir, 'summary.json'), JSON.stringify(summary, null, 2));
    log('Artifacts: ' + run.dir);
    await ask('Press Enter to close the browser... ');
    await ctx.close();
  }
})();