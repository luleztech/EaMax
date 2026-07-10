#!/usr/bin/env node
/**
 * Verifies payment → premium activation plumbing (no live gateway required).
 */
const http = require('http');
const express = require('express');
const { initializeRealtimeServer } = require('../src/services/realtimeServer');
const { requireAppVersion } = require('../src/middleware/appVersion');
const {
  __paymentTestHelpers: h,
} = require('../src/routes/payments');

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const tests = [
  {
    name: 'initializeRealtimeServer exposes notifyPremiumUpdate + notifyPaymentReceived',
    fn: () => {
      const server = http.createServer();
      const rt = initializeRealtimeServer(server);
      assert(typeof rt.notifyPremiumUpdate === 'function', 'notifyPremiumUpdate missing');
      assert(typeof rt.notifyPaymentReceived === 'function', 'notifyPaymentReceived missing');
      assert(typeof rt.broadcastToUser === 'function', 'broadcastToUser missing');
      server.close();
    },
  },
  {
    name: 'payment webhooks bypass REQUIRE_APP_VERSION gate',
    fn: async () => {
      const prev = process.env.REQUIRE_APP_VERSION;
      process.env.REQUIRE_APP_VERSION = 'true';
      const app = express();
      app.use('/api/', requireAppVersion);
      app.post('/api/payments/aurax/webhook', (_req, res) => res.json({ ok: true }));
      app.post('/api/payments/sonicpesa/webhook', (_req, res) => res.json({ ok: true }));
      app.get('/api/users/test', (_req, res) => res.json({ blocked: true }));

      const listen = () =>
        new Promise((resolve) => {
          const server = app.listen(0, '127.0.0.1', () => resolve(server));
        });

      const server = await listen();
      const port = server.address().port;
      const base = `http://127.0.0.1:${port}`;

      const aurax = await fetch(`${base}/api/payments/aurax/webhook`, { method: 'POST' });
      assert(aurax.status === 200, `aurax webhook blocked: ${aurax.status}`);

      const sonic = await fetch(`${base}/api/payments/sonicpesa/webhook`, { method: 'POST' });
      assert(sonic.status === 200, `sonic webhook blocked: ${sonic.status}`);

      const mobile = await fetch(`${base}/api/users/test`, {
        headers: { 'X-App-Version': '0.0.1' },
      });
      assert(mobile.status === 426, `expected mobile 426, got ${mobile.status}`);

      await new Promise((r) => server.close(r));
      if (prev === undefined) delete process.env.REQUIRE_APP_VERSION;
      else process.env.REQUIRE_APP_VERSION = prev;
    },
  },
  {
    name: 'Aurax paid detection still works',
    fn: () => {
      const payload = {
        event: 'payment.completed',
        transaction: {
          id: 'AXP-1',
          status: 'PROCESSING',
          metadata: { orderId: 'a1b2c3d4-e5f6-4789-a012-3456789abcde' },
        },
      };
      const { paid } = h.extractAuraxWebhookOrderAndPaid(payload);
      assert(paid === true, 'aurax paid detection failed');
    },
  },
  {
    name: 'Sonic paid detection still works',
    fn: () => {
      const payload = { order_id: 'SONIC-99', data: [{ payment_status: 'COMPLETED' }] };
      const { paid } = h.extractSonicWebhookOrderAndPaid(payload);
      assert(paid === true, 'sonic paid detection failed');
    },
  },
];

(async () => {
  let passed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`✅ ${t.name}`);
      passed += 1;
    } catch (err) {
      console.error(`❌ ${t.name}: ${err.message}`);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${tests.length} payment activation plumbing tests passed`);
})();
