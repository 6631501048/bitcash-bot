const express = require('express');
const cfg = require('./config');
const { createStore } = require('./services/orderStore');
const { createOrderService, ApiError } = require('./services/orderService');

function createApp({ runner, store = createStore() } = {}) {
  if (!runner) throw new Error('createApp requires a runner');
  const service = createOrderService({ store, runner, packPriceJpy: cfg.packPriceJpy });
  const app = express();
  app.use(express.json({ limit: '10kb' }));
  const wrap = (handler) => (req, res) => {
    try { handler(req, res); } catch (error) {
      if (error instanceof ApiError) return res.status(error.http).json({ error: { code: error.code, message: error.message } });
      console.error(error); return res.status(500).json({ error: { code: 'INTERNAL', message: 'Unexpected server error' } });
    }
  };
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.post('/orders', wrap((req, res) => {
    const { order, replayed } = service.create({ dryRun: req.body?.dryRun !== false, confirm: req.body?.confirm, idempotencyKey: req.get('Idempotency-Key') });
    res.status(replayed ? 200 : 202).json(order);
  }));
  app.get('/orders', wrap((_req, res) => res.json(service.list())));
  app.get('/orders/:id', wrap((req, res) => { const order = service.get(req.params.id); if (!order) throw new ApiError(404, 'NOT_FOUND', 'Order not found'); res.json(order); }));
  app.post('/orders/:id/otp', wrap((req, res) => res.json(service.submitOtp(req.params.id, req.body?.otp))));
  app.post('/orders/:id/resolve', wrap((req, res) => res.json(service.resolve(req.params.id, req.body?.resolution))));
  app.get('/balance', wrap((_req, res) => res.json(service.balance())));
  return app;
}
module.exports = { createApp };
if (require.main === module) {
  const { runFlow } = require('./flow');
  const port = Number(process.env.PORT || 3000);
  createApp({ runner: runFlow }).listen(port, () => console.log(`Bitcash bot API listening at http://localhost:${port}`));
}
