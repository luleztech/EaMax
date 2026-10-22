const assert = require('assert');
const {
  isPhoneUssdBusyMessage,
  isGatewayBusyFailure,
} = require('../src/services/paymentGatewayPressure');

assert.strictEqual(isGatewayBusyFailure('Too many requests', '', 429), true);
assert.strictEqual(isPhoneUssdBusyMessage('Too many requests', 429), false);

assert.strictEqual(isGatewayBusyFailure('rate limit exceeded', '429', 429), true);
assert.strictEqual(isPhoneUssdBusyMessage('rate limit exceeded', '429'), false);

assert.strictEqual(isPhoneUssdBusyMessage('too many attempts', ''), true);
assert.strictEqual(isGatewayBusyFailure('too many attempts', '', 400), false);

assert.strictEqual(isPhoneUssdBusyMessage('Ongoing USSD session', '103'), true);
assert.strictEqual(isGatewayBusyFailure('Ongoing USSD session', '103', 400), false);

assert.strictEqual(isPhoneUssdBusyMessage('maombi mengi', ''), false);
assert.strictEqual(isGatewayBusyFailure('timeout', '', 504), true);

console.log('payment gateway pressure classification passed');
