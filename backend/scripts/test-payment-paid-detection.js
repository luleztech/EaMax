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
    name: 'Sonic poll: envelope success + payment_status PENDING is not paid',
    fn: () => {
      const payload = {
        status: 'success',
        message: 'Order status retrieved successfully',
        data: {
          order_id: 'SONIC-PENDING-1',
          payment_status: 'PENDING',
          transid: null,
          channel: null,
        },
        transaction: { order_id: 'SONIC-PENDING-1', status: 'PENDING' },
      };
      const { isCompleted, rawStatus } = h.evaluateSonicOrderStatusForApply(payload);
      assert(isCompleted === false, 'expected unpaid while waiting for PIN');
      assert(rawStatus === 'PENDING', `expected PENDING, got ${rawStatus}`);
      const { paid } = h.extractSonicWebhookOrderAndPaid(payload);
      assert(paid === false, 'webhook must not grant premium before PIN');
    },
  },
  {
    name: 'Sonic poll: envelope success without payment_status is not paid',
    fn: () => {
      const payload = {
        status: 'success',
        message: 'Payment order created. Push USSD sent',
        data: { order_id: 'SONIC-CREATE-1' },
      };
      const { isCompleted } = h.evaluateSonicOrderStatusForApply(payload);
      assert(isCompleted === false, 'create_order success envelope must stay unpaid');
    },
  },
  {
    name: 'Sonic poll: payment_status SUCCESS is paid after PIN',
    fn: () => {
      const payload = {
        status: 'success',
        message: 'Order status retrieved successfully',
        data: {
          order_id: 'SONIC-PAID-1',
          payment_status: 'SUCCESS',
          transid: '26292628111262',
          channel: 'MPESATZ',
        },
        transaction: { order_id: 'SONIC-PAID-1', status: 'SUCCESS' },
      };
      const { isCompleted, rawStatus } = h.evaluateSonicOrderStatusForApply(payload);
      assert(isCompleted === true, 'expected paid after PIN');
      assert(rawStatus === 'SUCCESS', `expected SUCCESS payment_status, got ${rawStatus}`);
    },
  },
  {
    name: 'Sonic webhook: resultCode 0 STK ack is not paid',
    fn: () => {
      const payload = {
        order_id: 'SONIC-STK-ACK',
        status: 'success',
        resultCode: '0',
        data: { payment_status: 'PENDING' },
      };
      const { paid } = h.extractSonicWebhookOrderAndPaid(payload);
      assert(paid === false, 'resultCode 0 must not activate premium');
    },
  },
  {
    name: 'Sonic webhook: payment.completed event still unpaid if payment_status PENDING',
    fn: () => {
      const payload = {
        event: 'payment.completed',
        order_id: 'SONIC-EVENT-PENDING',
        data: { payment_status: 'PENDING' },
      };
      const { paid } = h.extractSonicWebhookOrderAndPaid(payload);
      assert(paid === false, 'event must not override PENDING payment_status');
    },
  },
  {
    name: 'Sonic OK acknowledgement is not a paid transaction',
    fn: () => {
      const payload = { order_id: 'SONIC-ACK-1', data: [{ payment_status: 'OK' }] };
      const { paid } = h.extractSonicWebhookOrderAndPaid(payload);
      assert(paid === false, 'expected OK acknowledgement to stay unpaid');
    },
  },
  {
    name: 'collectAuraxOrderRefs prioritizes metadata orderId',
    fn: () => {
      const refs = h.collectAuraxOrderRefs({
        transaction: { id: gatewayId, metadata: { orderId: clientOrderId } },
      });
      assert(refs.includes(clientOrderId), `expected metadata orderId in refs, got ${refs.join(',')}`);
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
  {
    name: 'Vodacom/MPESA: paymentStatus SUCCESS means wallet paid (not STK ack)',
    fn: () => {
      const payload = {
        channel: 'MPESA',
        transaction: {
          id: gatewayId,
          status: 'SUCCESS',
          paymentStatus: 'SUCCESS',
          buyerPhone: '+255744000111',
          amount: 2000,
          metadata: { orderId: clientOrderId },
        },
      };
      const { paid, orderId } = h.extractAuraxWebhookOrderAndPaid(payload);
      assert(paid === true, 'expected Vodacom paymentStatus SUCCESS to be paid');
      assert(orderId === clientOrderId, `expected client orderId, got ${orderId}`);
      const phones = h.collectPaymentPhoneHints(payload);
      assert(phones.includes('0744000111'), `expected Vodacom phone hint, got ${phones.join(',')}`);
    },
  },
  {
    name: 'Vodacom/MPESA null transaction: data.payment_status SUCCESS still paid',
    fn: () => {
      const payload = {
        transaction: null,
        channel: 'MPESA',
        data: {
          id: gatewayId,
          payment_status: 'SUCCESS',
          order_id: clientOrderId,
          buyerPhone: '0744123456',
          amount: '2,000',
        },
      };
      const { paid, orderId } = h.extractAuraxWebhookOrderAndPaid(payload);
      assert(paid === true, 'expected null-tx MPESA payment_status SUCCESS to be paid');
      assert(orderId === clientOrderId, `expected orderId ${clientOrderId}, got ${orderId}`);
      assert(h.collectPaymentAmountHint(payload) === 2000, 'expected amount hint 2000 from formatted string');
      assert(h.collectPaymentPhoneHints(payload).includes('0744123456'), 'expected local Vodacom phone');
    },
  },
  {
    name: 'NULL transaction: data.payment_status SUCCESSFUL still paid (all networks)',
    fn: () => {
      const payload = {
        success: true,
        transaction: null,
        data: {
          id: gatewayId,
          payment_status: 'SUCCESSFUL',
          order_id: clientOrderId,
          buyerPhone: '+255744000111',
          amount: 1000,
        },
      };
      const { paid, orderId } = h.extractAuraxWebhookOrderAndPaid(payload);
      assert(paid === true, 'expected paid=true with null transaction');
      assert(orderId === clientOrderId, `expected orderId ${clientOrderId}, got ${orderId}`);
      const phones = h.collectPaymentPhoneHints(payload);
      assert(phones.includes('0744000111'), `expected local phone hint, got ${phones.join(',')}`);
      assert(h.collectPaymentAmountHint(payload) === 1000, 'expected amount hint 1000');
    },
  },
  {
    name: 'NULL transaction: root paymentStatus COMPLETED coerces transaction',
    fn: () => {
      const payload = {
        transaction: null,
        paymentStatus: 'COMPLETED',
        id: gatewayId,
        metadata: { orderId: clientOrderId },
      };
      const tx = h.coerceAuraxTransactionObject(payload);
      assert(tx && tx.id === gatewayId, 'expected coerced transaction id');
      const { isCompleted } = h.evaluateAuraxOrderStatusForApply(payload);
      assert(isCompleted === true, 'expected root paymentStatus COMPLETED to be paid');
    },
  },
  {
    name: 'NULL transaction string id still resolves refs',
    fn: () => {
      const payload = {
        transaction: gatewayId,
        payment_status: 'COLLECTED',
        metadata: { orderId: clientOrderId },
      };
      const refs = h.collectAuraxOrderRefs(payload);
      assert(refs.includes(gatewayId), 'expected string transaction id in refs');
      assert(refs.includes(clientOrderId), 'expected metadata orderId in refs');
      const { paid } = h.extractAuraxWebhookOrderAndPaid(payload);
      assert(paid === true, 'expected paid=true for string transaction + payment_status');
    },
  },
  {
    name: 'Halopesa/Airtel/Mpesa/Tigo: nested data array with null top-level transaction',
    fn: () => {
      for (const channel of ['HALOPESA', 'AIRTEL_MONEY', 'MPESA', 'TIGO_PESA']) {
        const payload = {
          transaction: null,
          channel,
          data: [
            {
              id: `${gatewayId}-${channel}`,
              payment_status: 'COMPLETED',
              metadata: { orderId: clientOrderId },
            },
          ],
        };
        const { paid, orderId } = h.extractAuraxWebhookOrderAndPaid(payload);
        assert(paid === true, `${channel}: expected paid`);
        assert(orderId === clientOrderId, `${channel}: expected client orderId`);
      }
    },
  },
  {
    name: 'Sonic null data object with root payment_status COMPLETED',
    fn: () => {
      const payload = {
        order_id: 'SONIC-NULL-DATA',
        data: null,
        payment_status: 'COMPLETED',
      };
      const { paid, orderId } = h.extractSonicWebhookOrderAndPaid(payload);
      assert(paid === true, 'expected paid with null data');
      assert(orderId === 'SONIC-NULL-DATA', 'expected sonic order id');
    },
  },
  {
    name: 'Aurax: paid:true flag unlocks even if status is PROCESSING',
    fn: () => {
      const payload = {
        paid: true,
        transaction: {
          id: gatewayId,
          status: 'PROCESSING',
          metadata: { orderId: clientOrderId },
        },
      };
      const { paid, orderId } = h.extractAuraxWebhookOrderAndPaid(payload);
      assert(paid === true, 'expected paid=true from paid flag');
      assert(orderId === clientOrderId, 'expected client orderId');
    },
  },
  {
    name: 'Aurax: resultCode 0 with paymentStatus SUCCESS maps to paid',
    fn: () => {
      const payload = {
        transaction: {
          id: gatewayId,
          paymentStatus: 'SUCCESS',
          resultCode: '0',
          metadata: { orderId: clientOrderId },
        },
      };
      const { paid } = h.extractAuraxWebhookOrderAndPaid(payload);
      assert(paid === true, 'expected paid from paymentStatus SUCCESS + resultCode 0');
    },
  },
  {
    name: 'Aurax: resultCode 0 alone without paymentStatus stays unpaid (STK ack)',
    fn: () => {
      const payload = {
        transaction: {
          id: gatewayId,
          status: 'PROCESSING',
          resultCode: '0',
          metadata: { orderId: clientOrderId },
        },
      };
      const { paid } = h.extractAuraxWebhookOrderAndPaid(payload);
      assert(paid === false, 'expected unpaid for resultCode-only STK ack');
    },
  },
  {
    name: 'Aurax: resultCode 0 with paid_at settles as paid',
    fn: () => {
      const payload = {
        transaction: {
          id: gatewayId,
          resultCode: '0',
          paid_at: '2026-08-09T12:00:00Z',
          metadata: { orderId: clientOrderId },
        },
      };
      const { paid } = h.extractAuraxWebhookOrderAndPaid(payload);
      assert(paid === true, 'expected paid from resultCode + paid_at');
    },
  },
  {
    name: 'Aurax: bare envelope SUCCESS without payment fields stays unpaid',
    fn: () => {
      const payload = {
        success: true,
        status: 'SUCCESS',
        transaction: { id: gatewayId, status: 'PENDING', metadata: { orderId: clientOrderId } },
      };
      const { paid } = h.extractAuraxWebhookOrderAndPaid(payload);
      assert(paid === false, 'expected unpaid for STK ack SUCCESS');
    },
  },
  {
    name: 'Sonic phone candidates: Halo/Airtel/Tigo try local 0… first',
    fn: () => {
      const halo = h.sonicPhoneCandidatesForApi('0611234567');
      assert(halo[0] === '0611234567', `halo first ${halo[0]}`);
      assert(halo.includes('255611234567'), `halo missing 255, got ${halo.join(',')}`);
      const airtel = h.sonicPhoneCandidatesForApi('0788123456');
      assert(airtel[0] === '0788123456', `airtel first ${airtel[0]}`);
      const tigo = h.sonicPhoneCandidatesForApi('0711234567');
      assert(tigo[0] === '0711234567', `tigo first ${tigo[0]}`);
    },
  },
  {
    name: 'Sonic phone candidates: Vodacom tries 255… first',
    fn: () => {
      const vod = h.sonicPhoneCandidatesForApi('0744123456');
      assert(vod[0] === '255744123456', `vod first ${vod[0]}`);
      assert(vod.includes('0744123456'), 'vod missing local');
    },
  },
  {
    name: 'Sonic USSD push: documented create_order success is sent',
    fn: () => {
      const payload = {
        status: 'success',
        message: 'Payment order created successfully! Push USSD sent to your phone.',
        data: {
          order_id: 'sp_69be15e08c830',
          reference: 'S20467752501',
          payment_status: 'PENDING',
          msisdn: '255657779003',
        },
      };
      assert(h.isSonicUssdPushSent(payload) === true, 'expected USSD sent');
    },
  },
  {
    name: 'Sonic USSD push: envelope success without msisdn/message is not sent',
    fn: () => {
      const payload = {
        status: 'success',
        message: 'OK',
        data: { order_id: 'sp_ghost', payment_status: 'PENDING', reference: 'S20467752501' },
      };
      assert(h.isSonicUssdPushSent(payload) === false, 'ghost order must not count as push');
    },
  },
  {
    name: 'Sonic webhook: official payment.completed without transid (all networks)',
    fn: () => {
      for (const channel of ['MPESATZ', 'TIGOPESATZ', 'AIRTELMONEY', 'HALOPESATZ']) {
        const payload = {
          event: 'payment.completed',
          order_id: `SONIC-${channel}`,
          status: 'SUCCESS',
          channel,
          msisdn: '255744123456',
          amount: 2000,
        };
        const { paid, orderId } = h.extractSonicWebhookOrderAndPaid(payload);
        assert(paid === true, `${channel}: expected paid=true`);
        assert(orderId === `SONIC-${channel}`, `${channel}: bad orderId ${orderId}`);
      }
    },
  },
  {
    name: 'Sonic poll: transaction.status SUCCESS without payment_status (all networks)',
    fn: () => {
      const payload = {
        status: 'success',
        data: { order_id: 'SONIC-TX-ONLY', transid: '26292628111262', msisdn: '255744123456' },
        transaction: { order_id: 'SONIC-TX-ONLY', status: 'SUCCESS', amount: '2000' },
      };
      const { isCompleted } = h.evaluateSonicOrderStatusForApply(payload);
      assert(isCompleted === true, 'expected paid from transaction.status');
    },
  },
  {
    name: 'Sonic webhook: payment.failed stays unpaid',
    fn: () => {
      const payload = { event: 'payment.failed', order_id: 'SONIC-FAIL', status: 'FAILED' };
      const { paid } = h.extractSonicWebhookOrderAndPaid(payload);
      assert(paid === false, 'expected unpaid for payment.failed');
    },
  },
  {
    name: 'Sonic buyer_name does not send a UUID to the gateway',
    fn: () => {
      const name = h.sonicBuyerNameForApi('a1b2c3d4-e5f6-4789-a012-3456789abcde', 'a1b2c3d4-e5f6-4789-a012-3456789abcde');
      assert(name === 'EaMax Customer', `got ${name}`);
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
