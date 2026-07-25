#!/usr/bin/env node
/**
 * Verifies AuraxPay / SonicPesa paid-detection and webhook parsing (no DB required).
 */
const {
  __paymentTestHelpers: h,
} = require('../src/routes/payments');

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const clientOrderId = 'a1b2c3d4-e5f6-4789-a012-3456789abcde';
const gatewayId = 'AXP-TXN-991';

const cases = [
  {
    name: 'Aurax webhook: status PENDING but paymentStatus COMPLETED',
    fn: () => {
      const payload = {
        event: 'payment.notification',
        transaction: {
          id: gatewayId,
          status: 'PENDING',
          paymentStatus: 'COMPLETED',
          metadata: { orderId: clientOrderId },
        },
      };
      const { paid, orderId } = h.extractAuraxWebhookOrderAndPaid(payload);
      assert(paid === true, 'expected paid=true');
      assert(orderId === clientOrderId, `expected client orderId, got ${orderId}`);
    },
  },
  {
    name: 'Aurax webhook: nested data.transaction.payment_status',
    fn: () => {
      const payload = {
        data: {
          transaction: {
            id: gatewayId,
            payment_status: 'SUCCESSFUL',
            metadata: { order_id: clientOrderId },
          },
        },
      };
      const { paid, orderId } = h.extractAuraxWebhookOrderAndPaid(payload);
      assert(paid === true, 'expected paid=true');
      assert(orderId === clientOrderId, `expected client orderId, got ${orderId}`);
    },
  },
  {
    name: 'Aurax poll: success flag with transaction.state collected',
    fn: () => {
      const payload = {
        success: true,
        transaction: { id: gatewayId, state: 'COLLECTED', metadata: { orderId: clientOrderId } },
      };
      const { isCompleted } = h.evaluateAuraxOrderStatusForApply(payload);
      assert(isCompleted === true, 'expected isCompleted=true');
    },
  },
  {
    name: 'Aurax webhook: payment.completed event',
    fn: () => {
      const payload = {
        event: 'payment.completed',
        transaction: { id: gatewayId, status: 'PROCESSING', metadata: { orderId: clientOrderId } },
      };
      const { paid } = h.extractAuraxWebhookOrderAndPaid(payload);
      assert(paid === true, 'expected paid=true from event');
    },
  },
  {
    name: 'Aurax webhook: unpaid stays unpaid',
    fn: () => {
      const payload = {
        transaction: { id: gatewayId, status: 'PENDING', paymentStatus: 'PENDING' },
      };
      const { paid } = h.extractAuraxWebhookOrderAndPaid(payload);
      assert(paid === false, 'expected paid=false');
    },
  },
  {
    name: 'Sonic webhook: payment_status COMPLETED in data array',
    fn: () => {
      const payload = {
        order_id: 'SONIC-ORDER-42',
        data: [{ payment_status: 'COMPLETED' }],
      };
      const { paid, orderId } = h.extractSonicWebhookOrderAndPaid(payload);
      assert(paid === true, 'expected paid=true');
      assert(orderId === 'SONIC-ORDER-42', `expected sonic order id, got ${orderId}`);
    },
  },
  {
    name: 'collectAuraxOrderRefs prioritizes metadata orderId',
    fn: () => {
      const refs = h.collectAuraxOrderRefs({
        transaction: { id: gatewayId, metadata: { orderId: clientOrderId } },
      });
      assert(refs[0] === clientOrderId, `expected metadata orderId first, got ${refs[0]}`);
    },
  },
  {
    name: 'Aurax SUCCESS alone (STK ack) is not paid',
    fn: () => {
      const payload = {
        success: true,
        status: 'SUCCESS',
        transaction: {
          id: gatewayId,
          status: 'SUCCESS',
          paymentStatus: 'PENDING',
          metadata: { orderId: clientOrderId },
        },
      };
      const { isCompleted } = h.evaluateAuraxOrderStatusForApply(payload);
      assert(isCompleted === false, 'expected SUCCESS+PENDING paymentStatus to stay unpaid');
    },
  },
  {
    name: 'Aurax paymentStatus COMPLETED still paid even if status SUCCESS',
    fn: () => {
      const payload = {
        success: true,
        status: 'SUCCESS',
        transaction: {
          id: gatewayId,
          status: 'SUCCESS',
          paymentStatus: 'COMPLETED',
          metadata: { orderId: clientOrderId },
        },
      };
      const { isCompleted } = h.evaluateAuraxOrderStatusForApply(payload);
      assert(isCompleted === true, 'expected paymentStatus COMPLETED to be paid');
    },
  },
];

let passed = 0;
for (const c of cases) {
  try {
    c.fn();
    console.log(`✅ ${c.name}`);
    passed += 1;
  } catch (err) {
    console.error(`❌ ${c.name}: ${err.message}`);
    process.exitCode = 1;
  }
}

console.log(`\n${passed}/${cases.length} payment detection tests passed`);
