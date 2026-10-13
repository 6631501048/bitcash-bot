const { BotError, CODES } = require('../utils/errors');
const { sleep, log, humanType, poll, assist } = require('../utils/helpers');

/** Step 1 of Bitcash: confirm amount, choose MyBitCash, reach the login form. Safe (no money moves). */
async function toLoginForm(popup, cfg) {
  await popup.locator('#mbcSettle').waitFor({ state: 'visible', timeout: 20000 });
  const body = await popup.locator('body').innerText();
  const m = body.match(/(\d[\d,]*)\s*クレジット/);
  if (!m || Number(m[1].replace(/,/g, '')) !== cfg.packPriceJpy)
    throw new BotError(CODES.AMOUNT_MISMATCH, `Bitcash amount is ${m ? m[1] : '?'} not ${cfg.packPriceJpy}`);

  await popup.locator('#mbcSettle').click();
  await popup.locator('#membersId').waitFor({ state: 'visible', timeout: 20000 });
  log('reached MyBitCash login form');
}

const hasRecaptcha = (popup) => popup.frames().some((f) => /recaptcha/i.test(f.url()));

/**
 * Step 2: fill ID/password. The "次へ" button stays disabled until reCAPTCHA Enterprise
 * accepts the session; if it never enables we hand over to a human instead of faking it.
 * (Not called in dry-run.)
 */
async function login(popup, cfg) {
  cfg.require('bitcashId', 'bitcashPassword');
  await humanType(popup.locator('#membersId'), cfg.bitcashId);
  await humanType(popup.locator('#password'), cfg.bitcashPassword);

  const enabled = await poll(() => popup.locator('#buttonLogin').isEnabled(), 15000);
  if (!enabled) {
    log('login button still disabled (reCAPTCHA / App Check)');
    if (!cfg.manualAssist) throw new BotError(CODES.CAPTCHA_BLOCKED, 'MyBitCash login blocked by reCAPTCHA');
    await assist('Solve the captcha / press 次へ yourself.');
    return;
  }
  await popup.locator('#buttonLogin').click();
}

module.exports = { toLoginForm, login, hasRecaptcha };