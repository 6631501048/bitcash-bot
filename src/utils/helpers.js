const readline = require('readline');
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => Math.floor(a + Math.random() * (b - a));

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

/** Type like a human. Never logs the text (may be a password). */
async function humanType(locator, text) {
  await locator.click();
  await locator.fill('');
  await locator.pressSequentially(text, { delay: rand(60, 140) });
}

/** Wait until a frame whose URL contains `part` exists. */
async function findFrame(page, part, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const f = page.frames().find((fr) => fr.url().includes(part));
    if (f) return f;
    await sleep(300);
  }
  return null;
}

async function poll(fn, timeout = 20000, every = 400) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      if (await fn()) return true;
    } catch {}
    await sleep(every);
  }
  return false;
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(question, (a) => { rl.close(); res(a); }));
}

/** Human-in-the-loop: pause so the person can finish a step by hand. */
async function assist(message) {
  console.log('\n  >>> MANUAL ASSIST: ' + message);
  await ask('  Finish it in the browser, then press Enter to continue... ');
}

function makeRun(artifactsDir) {
  const dir = path.join(artifactsDir, 'run-' + new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  return {
    dir,
    async shot(page, label) {
      n += 1;
      const file = path.join(dir, `${String(n).padStart(2, '0')}-${label}.png`);
      await page.screenshot({ path: file, fullPage: false }).catch(() => {});
      return file;
    },
  };
}

module.exports = { sleep, rand, log, humanType, findFrame, poll, ask, assist, makeRun };