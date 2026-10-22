/**
 * Bounded gateway dispatcher.
 *
 * Mobile-money providers can delay or reject a burst of STK requests. Keeping
 * a small queue in front of the provider applies back-pressure instead of
 * losing requests. Limits are configurable per deployment.
 */
const MAX_CONCURRENCY = Math.min(
  Math.max(Number(process.env.PAYMENT_GATEWAY_MAX_CONCURRENCY) || 24, 1),
  48,
);
const MAX_QUEUED = Math.min(
  Math.max(Number(process.env.PAYMENT_GATEWAY_MAX_QUEUED) || 1000, 10),
  10000,
);

class PaymentGatewayQueueFullError extends Error {
  constructor() {
    super('Payment request queue is temporarily full');
    this.name = 'PaymentGatewayQueueFullError';
    this.statusCode = 503;
  }
}

const pending = [];
let active = 0;

const drain = () => {
  while (active < MAX_CONCURRENCY && pending.length) {
    const job = pending.shift();
    active += 1;
    Promise.resolve()
      .then(job.run)
      .then(job.resolve, job.reject)
      .finally(() => {
        active -= 1;
        drain();
      });
  }
};

const enqueuePaymentGatewayRequest = (run) => {
  if (pending.length >= MAX_QUEUED) {
    return Promise.reject(new PaymentGatewayQueueFullError());
  }
  return new Promise((resolve, reject) => {
    pending.push({ run, resolve, reject });
    setImmediate(drain);
  });
};

const getPaymentGatewayQueueStats = () => ({
  active,
  queued: pending.length,
  maxConcurrency: MAX_CONCURRENCY,
  maxQueued: MAX_QUEUED,
});

module.exports = {
  enqueuePaymentGatewayRequest,
  getPaymentGatewayQueueStats,
  PaymentGatewayQueueFullError,
};
