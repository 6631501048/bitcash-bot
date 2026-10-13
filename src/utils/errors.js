/** Error codes double as the "problems we hit" list for the README (question 2). */
class BotError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'BotError';
    this.code = code;
    this.details = details;
  }
}

const CODES = {
  LOGIN_FAILED: 'LOGIN_FAILED',
  UID_MISMATCH: 'UID_MISMATCH',
  PACK_NOT_FOUND: 'PACK_NOT_FOUND',
  PRICE_MISMATCH: 'PRICE_MISMATCH', // safety lock tripped
  LIMIT_REACHED: 'LIMIT_REACHED', // pack limited to 1 per account
  PAYMENT_DIALOG_TIMEOUT: 'PAYMENT_DIALOG_TIMEOUT',
  BITCASH_TAB_NOT_OPENED: 'BITCASH_TAB_NOT_OPENED',
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  CAPTCHA_BLOCKED: 'CAPTCHA_BLOCKED', // reCAPTCHA Enterprise on MyBitCash login
};

module.exports = { BotError, CODES };