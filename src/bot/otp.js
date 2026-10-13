const { log, ask, sleep, assist } = require('../utils/helpers');

/** Best-effort expiry display for the API; the OTP timeout remains the authority. */
async function readExpiry(popup) {
  const text = await popup.locator('body').innerText().catch(() => '');
  const match = text.match(/(?:expires?(?:\s+in)?|有効期限|残り)\D{0,12}(\d{1,2})\D+(\d{2})/i);
  if (!match) return null;
  const minutesLeft = Number(match[1]) + Number(match[2]) / 60;
  const expiresAt = new Date(Date.now() + minutesLeft * 60_000);
  return { minutesLeft: Math.ceil(minutesLeft), ict: expiresAt.toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok' }) };
}

/**
 * OTP provider. For now a person (HR) gives the 6-digit code and it is typed in the terminal.
 * Later this can be swapped for POST /orders/:id/otp or an Outlook mailbox reader
 * without touching the rest of the flow.
 * Note: the code is valid ~10 minutes (see the sample mail in the test sheet).
 */
async function getOtp() {
  for (;;) {
    const code = (await ask('Enter the 6-digit OTP from HR / Outlook: ')).trim();
    if (/^\d{6}$/.test(code)) return code;
    console.log('  OTP must be exactly 6 digits.');
  }
}

/** The OTP page shows 6 separate boxes (or 1 field). Fill whichever is present. */
async function fillOtp(popup, code, { manualAssist = true } = {}) {
  const inputs = popup.locator('input:visible:not([type=password]):not([type=hidden]):not([type=checkbox])');
  try {
    await inputs.first().waitFor({ state: 'visible', timeout: 20000 });
    const n = await inputs.count();
    if (n >= 6) {
      for (let i = 0; i < 6; i++) await inputs.nth(i).pressSequentially(code[i], { delay: 90 });
    } else {
      await inputs.first().pressSequentially(code, { delay: 90 });
    }
    log(`OTP entered (${n} input${n > 1 ? 's' : ''})`);
    await sleep(800);
    // Some pages need a confirm button; try the obvious ones, otherwise auto-submit is assumed
    await popup.locator('button[type=submit]:visible, #buttonNext:visible, #buttonLogin:visible').first()
      .click({ timeout: 2500 }).catch(() => {});
  } catch (e) {
    log('OTP page not as expected: ' + e.message.split('\n')[0]);
    if (!manualAssist) throw e;
    await assist(`Type this OTP yourself and submit: ${code}`);
  }
}

module.exports = { getOtp, fillOtp, readExpiry };
