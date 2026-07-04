function createRateLimiter(options = {}) {
  const windowMs = options.windowMs || 15 * 60 * 1000;
  const max = options.max || 100;
  const message = options.message || 'Too many requests. Please try again later.';
  const buckets = new Map();

  function clientKey(req) {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const extra = typeof options.key === 'function' ? options.key(req) : '';
    return `${ip}:${extra}`;
  }

  function sweep(now) {
    for (const [key, bucket] of buckets.entries()) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  return (req, res, next) => {
    const now = Date.now();
    if (buckets.size > 10000) sweep(now);

    const key = clientKey(req);
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    bucket.count += 1;
    if (bucket.count > max) {
      res.set('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ error: message });
    }

    next();
  };
}

module.exports = { createRateLimiter };
