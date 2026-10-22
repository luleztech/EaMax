const assert = require('assert');
const { enqueuePaymentGatewayRequest, getPaymentGatewayQueueStats } = require('../src/services/paymentRequestQueue');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  const initial = getPaymentGatewayQueueStats();
  const limit = initial.maxConcurrency;
  let active = 0;
  let peak = 0;

  const jobs = Array.from({ length: limit * 3 + 2 }, (_, index) =>
    enqueuePaymentGatewayRequest(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await wait(10 + (index % 3) * 2);
      active -= 1;
      return index;
    }),
  );

  const values = await Promise.all(jobs);
  assert.strictEqual(values.length, limit * 3 + 2);
  assert(peak <= limit, `queue exceeded concurrency: ${peak} > ${limit}`);
  assert.strictEqual(active, 0);
  assert.strictEqual(getPaymentGatewayQueueStats().queued, 0);
  console.log(`payment gateway queue passed (limit=${limit}, peak=${peak})`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
