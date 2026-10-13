/**
 * Phase 0: semi-manual site exploration.
 * You drive the browser by hand; after each step press Enter in the terminal
 * and the script records screenshots + a list of interactive elements
 * (selectors, iframes, popups), network hosts, and captcha hints.
 * Input VALUES are never recorded, so no passwords end up in the output.
 *
 * Run:  npm run setup && npm run explore
 * Stop before the final "Pay"/OTP step if you only want to explore (no money spent).
 */
require('dotenv').config();
const { chromium } = require('playwright');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const URL = process.env.MIDAS_URL ||
  'https://www.midasbuy.com/midasbuy/jp/shop/aoem?from=self_midasbuy_saas#!/pages/shop/items';
const OUT = path.join(process.env.ARTIFACTS_DIR || 'artifacts', 'explore-' + Date.now());
fs.mkdirSync(OUT, { recursive: true });

const STEPS = [
  '01-landing (select Region = Japan)',
  '02-login-form (open Sign in, form visible, do NOT submit yet)',
  '03-after-login',
  '04-uid-dialog (Player ID dialog open)',
  '05-after-uid-selected',
  '06-pack-list (pack 99+109 visible)',
  '07-payment-methods (Bitcash visible)',
  '08-bitcash-page (QR / MyBitCash options)',
  '09-mybitcash-login-form',
];

const hosts = new Set();
const events = [];

const ask = (rl, q) => new Promise((r) => rl.question(q, r));

// Runs inside the page: list interactive elements without values
const collect = () => {
  const sel = 'a,button,input,select,textarea,[role=button],[role=tab],[data-testid],[onclick]';
  const cssPath = (el) => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts = [];
    let n = el;
    while (n && n.nodeType === 1 && parts.length < 4) {
      let p = n.tagName.toLowerCase();
      const cls = (n.className && typeof n.className === 'string')
        ? n.className.trim().split(/\s+/).slice(0, 2).map((c) => '.' + CSS.escape(c)).join('') : '';
      parts.unshift(p + cls);
      n = n.parentElement;
    }
    return parts.join(' > ');
  };
  return [...document.querySelectorAll(sel)]
    .filter((el) => el.offsetParent !== null)
    .slice(0, 150)
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type'),
      id: el.id || null,
      name: el.getAttribute('name'),
      placeholder: el.getAttribute('placeholder'),
      testid: el.getAttribute('data-testid'),
      text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60),
      selector: cssPath(el),
    }));
};

async function snapshot(context, label) {
  const pages = context.pages();
  const result = { label, time: new Date().toISOString(), pages: [] };
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const entry = { index: i, url: page.url(), title: await page.title().catch(() => ''), frames: [] };
    await page.screenshot({ path: path.join(OUT, `${label.split(' ')[0]}-page${i}.png`), fullPage: true })
      .catch((e) => (entry.screenshotError = String(e)));
    for (const frame of page.frames()) {
      const els = await frame.evaluate(collect).catch(() => []);
      entry.frames.push({ url: frame.url(), isMain: frame === page.mainFrame(), elements: els });
    }
    const body = await page.evaluate(() => document.body.innerText.toLowerCase()).catch(() => '');
    entry.captchaHint = /captcha|recaptcha|hcaptcha|verify you are human|slider|geetest/.test(body) ||
      page.frames().some((f) => /captcha|geetest|recaptcha|hcaptcha/i.test(f.url()));
    result.pages.push(entry);
  }
  fs.writeFileSync(path.join(OUT, `${label.split(' ')[0]}.json`), JSON.stringify(result, null, 2));
  console.log(`  saved ${label.split(' ')[0]}: ${pages.length} page(s), captchaHint=${result.pages.some((p) => p.captchaHint)}`);
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const context = await browser.newContext({ locale: 'ja-JP', viewport: { width: 1366, height: 850 } });

  context.on('page', (p) => {
    events.push({ t: Date.now(), type: 'new-page/popup', url: p.url() });
    console.log('  [event] new page/popup opened');
  });
  context.on('request', (r) => {
    try { hosts.add(new URL(r.url()).host); } catch {}
  });
  context.on('response', (r) => {
    if (r.status() >= 400) events.push({ t: Date.now(), type: 'http-' + r.status(), url: r.url().split('?')[0] });
  });

  const page = await context.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('\nBrowser is open. Drive it manually. After each step, press Enter to record.\n');

  for (const step of STEPS) {
    await ask(rl, `>> Get to: ${step}\n   Press Enter when ready (or type "q" to finish): `)
      .then(async (ans) => {
        if (ans.trim().toLowerCase() === 'q') throw new Error('quit');
        await snapshot(context, step);
      });
  }

  rl.close();
  fs.writeFileSync(path.join(OUT, 'network-hosts.json'), JSON.stringify([...hosts].sort(), null, 2));
  fs.writeFileSync(path.join(OUT, 'events.json'), JSON.stringify(events, null, 2));
  console.log(`\nDone. Output in: ${OUT}`);
  await browser.close();
})().catch(async (e) => {
  if (e.message !== 'quit') console.error(e);
  fs.writeFileSync(path.join(OUT, 'network-hosts.json'), JSON.stringify([...hosts].sort(), null, 2));
  fs.writeFileSync(path.join(OUT, 'events.json'), JSON.stringify(events, null, 2));
  console.log(`Stopped. Partial output in: ${OUT}`);
  process.exit(0);
});
