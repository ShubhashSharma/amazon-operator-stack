/**
 * Exponential backoff with respect for Retry-After.
 *
 * Retries on 429 (rate limited) and 5xx. Does NOT retry on 400 (role granted,
 * params wrong — retrying won't help) or 403 (role denied — retrying won't help).
 */

import { classifyError, type ClassifiedError } from './classify-error.js';

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  /** Multiplier for exponential backoff (default 2). */
  factor?: number;
}

export class AmazonApiError extends Error {
  constructor(public readonly classified: ClassifiedError) {
    super(`[${classified.status} ${classified.class}] ${classified.message}`);
    this.name = 'AmazonApiError';
  }
}

/**
 * Run an async function with retries. The function should throw an AmazonApiError
 * for HTTP errors that are classifiable; bare network errors are also retried.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxAttempts   = opts.maxAttempts   ?? 4;
  const initialDelay  = opts.initialDelayMs ?? 1000;
  const maxDelay      = opts.maxDelayMs    ?? 60000;
  const factor        = opts.factor        ?? 2;

  let attempt = 0;
  let delay = initialDelay;

  while (true) {
    attempt++;
    try {
      return await fn();
    } catch (err) {
      const classified = err instanceof AmazonApiError ? err.classified : null;

      // Decide whether to retry
      const shouldRetry =
        attempt < maxAttempts &&
        (classified
          ? classified.action === 'retry'
          : isNetworkError(err));

      if (!shouldRetry) throw err;

      // Honour Retry-After header if present (set by the HTTP layer onto classified.body)
      let waitMs = delay;
      if (classified?.body && typeof classified.body === 'object') {
        const ra = (classified.body as Record<string, unknown>)['__retryAfterMs'];
        if (typeof ra === 'number' && ra > 0) waitMs = Math.min(ra, maxDelay);
      }

      // Add jitter (±25%) so retries don't synchronise across processes
      const jitter = waitMs * (Math.random() * 0.5 - 0.25);
      const finalWait = Math.max(0, Math.round(waitMs + jitter));

      await new Promise(r => setTimeout(r, finalWait));
      delay = Math.min(maxDelay, delay * factor);
    }
  }
}

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  return (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT'  ||
    code === 'ENOTFOUND'  ||
    code === 'ECONNREFUSED'
  );
}

/**
 * Wrap a fetch response, throwing AmazonApiError if not OK.
 * Captures Retry-After in seconds and stashes the millisecond version on the body.
 */
export async function ensureOk(res: Response): Promise<unknown> {
  if (res.ok) return res.json().catch(() => ({}));

  const body = await res.json().catch(() => ({}));
  const retryAfterSec = parseInt(res.headers.get('retry-after') ?? '', 10);
  if (!isNaN(retryAfterSec) && retryAfterSec > 0) {
    (body as Record<string, unknown>)['__retryAfterMs'] = retryAfterSec * 1000;
  }

  throw new AmazonApiError(classifyError(res.status, body));
}
