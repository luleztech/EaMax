#!/usr/bin/env node
/**
 * End-to-end logic verification for ALL Tanzania mobile-money networks:
 * - Correct Aurax channel routing
 * - Money paid → treated as paid (unlock path)
 * - No money / failed / cancelled → NOT paid (no unlock)
 *
 * No live gateway / DB required.
 */
const {
  __paymentTestHelpers: h,
} = require('../src/routes/payments');

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const NETWORKS = [
  { name: 'M-Pesa (Vodacom)', phones: ['0744000111', '0755000222', '0766000333', '0799000444'], channel: 'MPESA' },
  { name: 'Airtel Money', phones: ['0688000555', '0699000666', '0788000777'], channel: 'AIRTEL_MONEY' },
  { name: 'Mixx by Yas (Tigo)', phones: ['0655000888', '0677000999', '0711000111', '0777000222'], channel: 'TIGO_PESA' },
  { name: 'HaloPesa (Halotel)', phones: ['0611000333', '0622000444', '0633000555'], channel: 'HALOPESA' },
];

const clientOrderId = 'a1b2c3d4-e5f6-4789-a012-3456789abcde';
const gatewayId = 'AXP-TXN-ALLNET';

let passed = 0;
let failed = 0;

const run = (name, fn) => {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`❌ ${name}`);
    console.error(`   ${err.message}`);
    failed += 1;
  }
};

console.log('=== Channel routing per network ===');
for (const net of NETWORKS) {
  run(`${net.name}: Aurax channel = ${net.channel}`, () => {
    for (const phone of net.phones) {
      const ch = h.resolveAuraxChannelFromPhone(phone);
      assert(ch === net.channel, `${phone} → ${ch}, expected ${net.channel}`);
    }
  });
}

console.log('\n=== Paid with money → unlock (all networks) ===');
for (const net of NETWORKS) {
  const phone = net.phones[0];
  run(`${net.name}: paymentStatus COMPLETED is paid`, () => {
    const payload = {
      event: 'payment.notification',
      channel: net.channel,
      transaction: {
        id: `${gatewayId}-${net.channel}`,
        status: 'PENDING',
        paymentStatus: 'COMPLETED',
        buyerPhone: phone,
        metadata: { orderId: clientOrderId },
      },
    };
    const { paid, orderId } = h.extractAuraxWebhookOrderAndPaid(payload);
    assert(paid === true, 'expected paid=true');
    assert(orderId === clientOrderId, `expected orderId, got ${orderId}`);
  });

  run(`${net.name}: paymentStatus SUCCESS (wallet debit) is paid`, () => {
    const payload = {
      transaction: {
        id: `${gatewayId}-S-${net.channel}`,
        paymentStatus: 'SUCCESS',
        metadata: { orderId: clientOrderId },
      },
    };
    const { paid } = h.extractAuraxWebhookOrderAndPaid(payload);
    assert(paid === true, 'expected Vodacom-style SUCCESS paymentStatus as paid');
  });

  run(`${net.name}: paid:true flag is paid`, () => {
    const payload = {
      paid: true,
      transaction: {
        id: `${gatewayId}-F-${net.channel}`,
        status: 'PROCESSING',
        metadata: { orderId: clientOrderId },
      },
    };
    const { paid } = h.extractAuraxWebhookOrderAndPaid(payload);
    assert(paid === true, 'expected paid flag');
  });

  run(`${net.name}: nested data array COMPLETED is paid`, () => {
    const payload = {
      transaction: null,
      channel: net.channel,
      data: [
        {
          id: `${gatewayId}-N-${net.channel}`,
          payment_status: 'COMPLETED',
          metadata: { orderId: clientOrderId },
        },
      ],
    };
    const { paid } = h.extractAuraxWebhookOrderAndPaid(payload);
    assert(paid === true, 'expected nested COMPLETED paid');
  });
}

console.log('\n=== No money / failed → must NOT unlock ===');
const unpaidCases = [
  { label: 'PENDING', payload: { transaction: { id: gatewayId, paymentStatus: 'PENDING', metadata: { orderId: clientOrderId } } } },
  { label: 'STK SUCCESS ack only', payload: { success: true, status: 'SUCCESS', transaction: { id: gatewayId, status: 'PENDING', metadata: { orderId: clientOrderId } } } },
  { label: 'FAILED', payload: { transaction: { id: gatewayId, paymentStatus: 'FAILED', metadata: { orderId: clientOrderId } } } },
  { label: 'CANCELLED', payload: { transaction: { id: gatewayId, paymentStatus: 'CANCELLED', metadata: { orderId: clientOrderId } } } },
  { label: 'INSUFFICIENT_FUNDS', payload: { transaction: { id: gatewayId, paymentStatus: 'INSUFFICIENT_FUNDS', metadata: { orderId: clientOrderId } } } },
  { label: 'INSUFFICIENT_BALANCE', payload: { transaction: { id: gatewayId, paymentStatus: 'INSUFFICIENT_BALANCE', metadata: { orderId: clientOrderId } } } },
  { label: 'NO_BALANCE', payload: { transaction: { id: gatewayId, paymentStatus: 'NO_BALANCE', metadata: { orderId: clientOrderId } } } },
  { label: 'DECLINED', payload: { transaction: { id: gatewayId, paymentStatus: 'DECLINED', metadata: { orderId: clientOrderId } } } },
  { label: 'EXPIRED', payload: { transaction: { id: gatewayId, paymentStatus: 'EXPIRED', metadata: { orderId: clientOrderId } } } },
];

for (const c of unpaidCases) {
  run(`Unpaid: ${c.label} is NOT paid`, () => {
    const { paid } = h.extractAuraxWebhookOrderAndPaid(c.payload);
    assert(paid === false, `expected unpaid for ${c.label}`);
  });
  run(`Terminal: ${c.label} recognized when terminal`, () => {
    const status = c.payload.transaction.paymentStatus || c.payload.status;
    if (status === 'SUCCESS' || status === 'PENDING') {
      assert(h.isPaymentTerminalStatus(status) === false, `${status} should not be terminal`);
      return;
    }
    assert(h.isPaymentTerminalStatus(status) === true, `${status} should be terminal`);
  });
}

run('Insufficient funds helper detects INSUFFICIENT_FUNDS', () => {
  assert(h.isInsufficientFundsStatus('INSUFFICIENT_FUNDS') === true);
  assert(h.isInsufficientFundsStatus('NO_BALANCE') === true);
  assert(h.isInsufficientFundsStatus('COMPLETED') === false);
});

run('Insufficient funds user message mentions salio', () => {
  const msg = h.mapTerminalStatusUserMessage('INSUFFICIENT_FUNDS');
  assert(/salio/i.test(msg), `expected salio message, got: ${msg}`);
});

console.log('\n=== Sonic paid vs unpaid ===');
run('Sonic COMPLETED is paid', () => {
  const { paid } = h.extractSonicWebhookOrderAndPaid({
    order_id: 'SONIC-1',
    data: [{ payment_status: 'COMPLETED' }],
  });
  assert(paid === true);
});

run('Sonic FAILED is not paid', () => {
  const { paid } = h.extractSonicWebhookOrderAndPaid({
    order_id: 'SONIC-2',
    data: [{ payment_status: 'FAILED' }],
  });
  assert(paid === false);
});

run('Sonic INSUFFICIENT_FUNDS is not paid', () => {
  const { paid } = h.extractSonicWebhookOrderAndPaid({
    order_id: 'SONIC-3',
    status: 'INSUFFICIENT_FUNDS',
    data: [{ payment_status: 'INSUFFICIENT_FUNDS' }],
  });
  assert(paid === false);
});

run('Sonic OK ack is not paid', () => {
  const { paid } = h.extractSonicWebhookOrderAndPaid({
    order_id: 'SONIC-4',
    data: [{ payment_status: 'OK' }],
  });
  assert(paid === false);
});

run('Sonic paid:true flag is paid', () => {
  const { paid } = h.extractSonicWebhookOrderAndPaid({
    order_id: 'SONIC-5',
    paid: true,
    data: [{ status: 'PROCESSING' }],
  });
  assert(paid === true);
});

console.log('\n=== Carrier helpers ===');
run('Carrier phone classifiers', () => {
  assert(h.isVodacomLocalPhone('0741234567') === true);
  assert(h.isAirtelLocalPhone('0681234567') === true);
  assert(h.isTigoLocalPhone('0711234567') === true);
  assert(h.isHalotelLocalPhone('0611234567') === true);
  assert(h.isVodacomLocalPhone('0611234567') === false);
});

console.log(`\n${passed}/${passed + failed} network payment flow tests passed`);
if (failed > 0) process.exit(1);
