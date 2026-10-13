const fs = require('fs');
const path = require('path');
const { BotError } = require('../utils/errors');
const { poll, log } = require('../utils/helpers');

const num = (s) => (s ? Number(s.replace(/,/g, '')) : null);

/** Parse the completion page text (請求番号 / お支払い額 / マイビットキャッシュ残高 ...). Pure function, easy to unit test. */
function parseResult(text) {
  const pick = (re) => (text.match(re) || [])[1] || null;
  return {
    invoiceNo: pick(/(INV\d+)/),
    paidAmount: num(pick(/お支払い額\s*([\d,]+)\s*クレジット/)),
    balance: num(pick(/残高\s*([\d,]+)\s*クレジット/)),
    transactionNo: pick(/トランザクション番号[:：]\s*(\d+)/),
    receivedAt: pick(/受付日時[:：]\s*([\d/]+\s+[\d:]+)/),
  };
}

/** Wait for the completion page, parse it, save a full-page screenshot + JSON. */
async function waitForResult(popup, runDir, expectedAmount) {
  const done = await poll(async () => {
    if (popup.isClosed()) return false;
    const t = await popup.locator('body').innerText();
    return /お支払いが完了|INV\d+/.test(t);
  }, 60000, 1000);
  if (!done) throw new BotError('RESULT_TIMEOUT', 'Completion page (Invoice No.) did not appear within 60s');

  const text = await popup.locator('body').innerText();
  const result = parseResult(text);
  result.expectedAmount = expectedAmount;
  result.amountOk = result.paidAmount === expectedAmount;
  result.screenshot = path.join(runDir, 'payment-complete.png');
  await popup.screenshot({ path: result.screenshot, fullPage: true });
  fs.writeFileSync(path.join(runDir, 'result.json'), JSON.stringify(result, null, 2));
  log(`RESULT invoice=${result.invoiceNo} paid=${result.paidAmount} balance=${result.balance} amountOk=${result.amountOk}`);
  return result;
}

module.exports = { parseResult, waitForResult };