const fs = require('fs');
const path = require('path');

/** Small durable store for the take-home exercise. It can be replaced by SQLite/Postgres. */
function createStore(file = path.join('data', 'orders.json')) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let orders = {};
  if (fs.existsSync(file)) {
    try { orders = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { orders = {}; }
  }
  const flush = () => fs.writeFileSync(file, JSON.stringify(orders, null, 2));
  return {
    get: (id) => orders[id],
    save: (order) => { orders[order.id] = order; flush(); },
    list: () => Object.values(orders).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

module.exports = { createStore };
