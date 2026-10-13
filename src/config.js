require('dotenv').config();

const bool = (v, d) => (v === undefined || v === '' ? d : String(v).toLowerCase() === 'true');

const cfg = {
  midasUrl:
    process.env.MIDAS_URL ||
    'https://www.midasbuy.com/midasbuy/jp/shop/aoem?from=self_midasbuy_saas#/pages/shop/items',
  email: process.env.MIDAS_EMAIL,
  password: process.env.MIDAS_PASSWORD,
  uid: process.env.PLAYER_UID,
  // Safety lock: only this price (pack 99+109) is ever allowed to be paid
  packPriceJpy: Number(process.env.PACK_PRICE_JPY || 146),
  bitcashId: process.env.BITCASH_ID,
  bitcashPassword: process.env.BITCASH_PASSWORD,
  chromeChannel: process.env.CHROME_CHANNEL === undefined ? 'chrome' : process.env.CHROME_CHANNEL,
  profileDir: process.env.PROFILE_DIR || '.profile',
  artifactsDir: process.env.ARTIFACTS_DIR || 'artifacts',
  slowMo: Number(process.env.SLOW_MO || 80),
  manualAssist: bool(process.env.MANUAL_ASSIST, true),
};

cfg.require = (...keys) => {
  const missing = keys.filter((k) => !cfg[k]);
  if (missing.length) throw new Error(`Missing config (see .env.example): ${missing.join(', ')}`);
};

module.exports = cfg;