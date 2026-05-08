/**
 * Token-bucket rate limiter, per endpoint.
 *
 * SP-API rate limits are documented per-endpoint in Amazon's docs and enforced
 * by the API; bursting past them gets you throttled for hours. We bake the
 * documented limits in here so callers can't accidentally exceed them.
 *
 * Sales & Traffic is the most aggressive: 1 request per 45 seconds.
 */

export interface RateLimit {
  /** Tokens added per second (refill rate). */
  ratePerSecond: number;
  /** Maximum tokens in the bucket (burst capacity). */
  burst: number;
}

// Documented SP-API limits per endpoint family. Lower than published if we
// have first-hand evidence of throttling at higher rates.
export const SP_API_LIMITS: Record<string, RateLimit> = {
  'orders/getOrders':                { ratePerSecond: 0.0167, burst: 20 },  // ~1/min
  'orders/getOrderItems':            { ratePerSecond: 0.5,    burst: 30 },
  'reports/createReport':            { ratePerSecond: 0.0167, burst: 15 },
  'reports/getReport':               { ratePerSecond: 2,      burst: 15 },
  'reports/getReportDocument':       { ratePerSecond: 0.0167, burst: 15 },
  'sales/getOrderMetrics':           { ratePerSecond: 0.5,    burst: 15 },
  'salesAndTraffic/getReport':       { ratePerSecond: 0.0222, burst: 1  },  // 1 / 45s — the big one
  'fbaInventory/getInventorySummaries': { ratePerSecond: 2,   burst: 2 },
  'finances/listFinancialEvents':    { ratePerSecond: 0.5,    burst: 30 },
  'listings/getListingsItem':        { ratePerSecond: 5,      burst: 10 },
};

// Ads API published limits are per-account, not per-endpoint, so a single
// shared bucket is sufficient.
export const ADS_API_LIMIT: RateLimit = { ratePerSecond: 2, burst: 10 };

class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(private readonly limit: RateLimit) {
    this.tokens = limit.burst;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    while (true) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      // Wait until at least one token is available
      const waitMs = Math.ceil((1 - this.tokens) / this.limit.ratePerSecond * 1000);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.limit.burst, this.tokens + elapsedSec * this.limit.ratePerSecond);
    this.lastRefill = now;
  }
}

const buckets = new Map<string, TokenBucket>();

/**
 * Acquire a token for the given endpoint, blocking until available.
 *
 * @param endpoint  Key into SP_API_LIMITS, or "ads-api" for the Ads bucket.
 */
export async function rateLimit(endpoint: string): Promise<void> {
  let bucket = buckets.get(endpoint);
  if (!bucket) {
    const limit =
      endpoint === 'ads-api'
        ? ADS_API_LIMIT
        : SP_API_LIMITS[endpoint] ?? { ratePerSecond: 1, burst: 5 };
    bucket = new TokenBucket(limit);
    buckets.set(endpoint, bucket);
  }
  await bucket.acquire();
}
