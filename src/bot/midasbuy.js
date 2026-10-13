const { BotError, CODES } = require('../utils/errors');
const { sleep, log, humanType, findFrame, poll, assist } = require('../utils/helpers');

const SIGN_IN_BANNER = /Sign In Midasbuy/i;

const mainText = (page) => page.evaluate(() => document.body.innerText).catch(() => '');

/** Cookie banner covers the lower right and can block clicks. */
async function rejectCookies(page) {
  await page.getByText('Reject All Optional Cookies', { exact: true }).first()
    .click({ timeout: 3000 }).catch(() => {});
}

async function open(page, cfg) {
  await page.goto(cfg.midasUrl, { waitUntil: 'domcontentloaded' });
  await page.getByText(/APEX COIN/i).first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
  await rejectCookies(page);
}

const UID_IN_HEADER = /\(\d{10,}\)/; // header shows "<nickname> (<UID>)" only when logged in

/**
 * Uses innerText (rendered text only). The earlier getByText().first().isVisible() check hit a
 * hidden duplicate of "Sign In Midasbuy" and wrongly reported "logged in" while the login modal was open.
 */
async function isLoggedIn(page) {
  const lf = page.frames().find((f) => f.url().includes('/apps/login'));
  if (lf && (await lf.getByText(/sign in successfully/i).first().isVisible().catch(() => false))) return true;
  const t = await mainText(page);
  return UID_IN_HEADER.test(t) && !SIGN_IN_BANNER.test(t);
}

/**
 * Login via "Sign in/up with other ways" (email + password).
 * NOTE: the email/password step lives inside the /apps/login iframe and was not captured
 * by the explore run, so selectors here are generic. If they miss, MANUAL_ASSIST lets
 * you finish by hand and send me the new snapshot to tighten them.
 */
async function login(page, cfg) {
  cfg.require('email', 'password');
  if (await isLoggedIn(page)) { log('already logged in'); return; }

  await page.getByText(SIGN_IN_BANNER).first().click();
  const frame = await findFrame(page, '/apps/login');
  if (!frame) throw new BotError(CODES.LOGIN_FAILED, 'Login iframe (/apps/login) did not appear');

  try {
    await frame.getByText(/Sign in\/up with other ways/i).first().click({ timeout: 10000 });

    const emailInput = frame
      .locator('input:not([type=password]):not([type=hidden]):not([type=checkbox]):not([type=radio])')
      .first();
    await emailInput.waitFor({ state: 'visible', timeout: 10000 });
    await humanType(emailInput, cfg.email);

    const pwd = frame.locator('input[type=password]').first();
    if (!(await pwd.isVisible().catch(() => false))) {
      // two-step form: press the primary button to reveal the password field
      await frame.getByText(/^Continue$/).first().click({ timeout: 5000 }).catch(() => emailInput.press('Enter'));
    }
    await pwd.waitFor({ state: 'visible', timeout: 10000 });
    await humanType(pwd, cfg.password);
    await frame.getByText(/^(Sign In|Log In|Login|Continue|Confirm)$/i).first().click({ timeout: 5000 }).catch(() => pwd.press('Enter'));
  } catch (e) {
    log('automated login step failed: ' + e.message.split('\n')[0]);
    if (!cfg.manualAssist) throw new BotError(CODES.LOGIN_FAILED, e.message);
    await assist('Complete the Midasbuy email/password login by hand.');
  }

  const ok = await poll(() => isLoggedIn(page), 45000);
  if (!ok) throw new BotError(CODES.LOGIN_FAILED, 'Login did not complete (wrong password, captcha or 2FA?)');
  log('login OK');
}

/** After login a "Create Passkey" popup appears; close it. */
async function dismissPopups(page) {
  const lf = page.frames().find((f) => f.url().includes('/apps/login'));
  if (lf && (await lf.getByText(/Create Passkey/i).first().isVisible().catch(() => false))) {
    const closed = await lf.locator('[class*="close" i], [aria-label*="close" i]').first()
      .click({ timeout: 3000 }).then(() => true).catch(() => false);
    if (!closed) await page.keyboard.press('Escape');
  }
  await rejectCookies(page);
  await sleep(500);
}

/** The page header shows "<nickname> (<UID>)" for the active player. */
async function ensureUid(page, cfg) {
  cfg.require('uid');
  const hasUid = async () => (await mainText(page)).includes(cfg.uid);
  if (await poll(hasUid, 20000)) { log('UID matches header: ' + cfg.uid); return; }

  log('UID not shown in header');
  if (!cfg.manualAssist) throw new BotError(CODES.UID_MISMATCH, `Active player is not ${cfg.uid}`);
  await assist(`Switch Player ID to ${cfg.uid} (header swap icon / "Enter Player ID" dialog, pick server Empire#239).`);
  if (!(await poll(hasUid, 15000)))
    throw new BotError(CODES.UID_MISMATCH, `Active player is still not ${cfg.uid}`);
}

/** Click pack "99 + 109" and make sure its price is 146円 (safety lock). */
async function selectPack(page, cfg) {
  const priceText = `${cfg.packPriceJpy}円`;
  const price = page.getByText(priceText, { exact: true }).first();
  if (!(await price.isVisible().catch(() => false)))
    throw new BotError(CODES.PACK_NOT_FOUND, `No pack priced ${priceText} on the page`);

  const cardText = await price.evaluate((el) => {
    let n = el;
    for (let i = 0; i < 6 && n.parentElement; i++) {
      n = n.parentElement;
      if (/99/.test(n.innerText) && /109/.test(n.innerText)) return n.innerText;
    }
    return '';
  });
  if (!cardText) throw new BotError(CODES.PACK_NOT_FOUND, 'Card with "99 + 109" not found next to the price');
  await price.click();
  log('pack selected: 99+109 @ ' + priceText);
}

/** Payment dialog: verify total, check purchase limit, choose BitCash, press PAY -> new tab. */
async function payWithBitcash(page, cfg) {
  const frame = await findFrame(page, 'payment-sdk', 15000);
  if (!frame) throw new BotError(CODES.PAYMENT_DIALOG_TIMEOUT, 'payment-sdk iframe not found');

  const opened = await frame.getByText(/SECURITY PAYMENT/i).first()
    .waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
  if (!opened) throw new BotError(CODES.PAYMENT_DIALOG_TIMEOUT, 'Payment dialog did not open');

  const text = await frame.locator('body').innerText();

  const lim = text.match(/Limit:\s*(\d+)\s*\/\s*(\d+)/i);
  if (lim && Number(lim[1]) >= Number(lim[2]))
    throw new BotError(CODES.LIMIT_REACHED, `Purchase limit reached (${lim[1]}/${lim[2]}) for this pack`);

  if (!text.includes(`${cfg.packPriceJpy}円`))
    throw new BotError(CODES.PRICE_MISMATCH, `Total is not ${cfg.packPriceJpy}円, refusing to pay`);

  await frame.getByText('BitCash', { exact: true }).first().click();
  await sleep(500);

  const popupPromise = page.context().waitForEvent('page', { timeout: 30000 });
  await frame.getByRole('button', { name: /^PAY$/ }).click();
  const popup = await popupPromise.catch(() => null);
  if (!popup) throw new BotError(CODES.BITCASH_TAB_NOT_OPENED, 'Bitcash tab did not open after PAY');
  await popup.waitForLoadState('domcontentloaded');
  log('Bitcash tab opened');
  return popup;
}

/**
 * After PAY, Midasbuy shows "Payment is in progress" (Refresh Result / Close) on the shop page.
 * "Refresh Result" is also how the shop side confirms the final status after a real payment.
 */
async function closePendingOrder(page) {
  for (const f of page.frames()) {
    const dlg = f.getByText(/Payment is in progress/i).first();
    if (await dlg.isVisible().catch(() => false)) {
      await f.getByText(/^Close$/).first().click({ timeout: 3000 }).catch(() => {});
      return true;
    }
  }
  return false;
}

/** After a real payment: press "Refresh Result" on the shop's "Payment is in progress" dialog. */
async function refreshResult(page) {
  for (const f of page.frames()) {
    const btn = f.getByText(/^Refresh Result$/).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ timeout: 3000 });
      await sleep(3000);
      return true;
    }
  }
  return false;
}

module.exports = { open, login, dismissPopups, ensureUid, selectPack, payWithBitcash, closePendingOrder, refreshResult };