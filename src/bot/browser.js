const { chromium } = require('playwright');
const { log } = require('../utils/helpers');

/**
 * Persistent profile + real Chrome + headed: the least "bot-looking" setup.
 * Falls back to bundled Chromium if Chrome is not installed.
 */
async function launch(cfg) {
  const opts = {
    headless: false,
    locale: 'en-US',
    viewport: { width: 1366, height: 850 },
    slowMo: cfg.slowMo,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled'],
  };
  if (cfg.chromeChannel) {
    try {
      return await chromium.launchPersistentContext(cfg.profileDir, { ...opts, channel: cfg.chromeChannel });
    } catch (e) {
      log(`Could not start channel "${cfg.chromeChannel}", falling back to Chromium: ${e.message.split('\n')[0]}`);
    }
  }
  return chromium.launchPersistentContext(cfg.profileDir, opts);
}

module.exports = { launch };