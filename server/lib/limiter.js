// Minimal in-process bounded-concurrency limiter.
//
// Guarantees that at most `max` wrapped async operations run at once, regardless of
// how many callers enqueue work. Used to decouple two rate-sensitive resources from
// the health-check worker-pool size:
//   • Google Postmaster API calls  (orchestrator.js)
//   • DNSBL DNS lookups            (blacklist.js)
// so raising HEALTH_CHECK_CONCURRENCY never fans those out proportionally.
//
// No dependencies. The queue stays saturated: a new task starts the instant a slot
// frees. A wrapped fn that throws rejects only its own promise — never the limiter.
function createLimiter(max) {
  const limit = Math.max(1, parseInt(max, 10) || 1);
  let active = 0;
  const queue = [];

  const pump = () => {
    if (active >= limit || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => { active--; pump(); });
  };

  return function run(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      pump();
    });
  };
}

module.exports = { createLimiter };
