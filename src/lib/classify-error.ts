/**
 * Classify Amazon API errors so callers can react correctly.
 *
 * The single most important rule, learned the hard way:
 *
 *   400 InvalidInput  →  role IS granted, parameters are wrong (PASS, with note)
 *   403 Unauthorized  →  role is NOT granted (FAIL)
 *
 * Probe harnesses that classify 400 as failure will chase phantom permission
 * issues that are already resolved. Don't.
 *
 * Reference: Brothers Turvey SP-API role probe, 22 April 2026.
 */

export type ErrorClass =
  | 'role_denied'        // 403 — caller doesn't have the role at all
  | 'role_granted_param' // 400 — role works, params are off
  | 'rate_limited'       // 429 — back off and retry
  | 'auth_expired'       // 401 — refresh token and retry once
  | 'server_error'       // 5xx — transient
  | 'not_found'          // 404 — resource doesn't exist
  | 'validation'         // 422 / other 4xx — caller error
  | 'unknown';

export interface ClassifiedError {
  class: ErrorClass;
  status: number;
  message: string;
  /** What the caller should do next. */
  action: 'retry' | 'refresh_auth' | 'fix_params' | 'request_role' | 'fail';
  /** Extra context for the user. */
  hint?: string;
  /** Raw response body if available. */
  body?: unknown;
}

export function classifyError(status: number, body: unknown): ClassifiedError {
  const message = extractMessage(body);

  if (status === 400) {
    return {
      class: 'role_granted_param',
      status,
      message,
      action: 'fix_params',
      hint:
        'A 400 means the role IS granted but parameters are wrong. ' +
        'Read the error message above and fix the request — do NOT request the role again.',
      body,
    };
  }

  if (status === 401) {
    return {
      class: 'auth_expired',
      status,
      message,
      action: 'refresh_auth',
      hint: 'Access token expired. The MCP server will refresh and retry once.',
      body,
    };
  }

  if (status === 403) {
    return {
      class: 'role_denied',
      status,
      message,
      action: 'request_role',
      hint:
        'You do not have this SP-API role. Go to Seller Central → Apps & Services → ' +
        'Develop Apps and grant the relevant role to your app.',
      body,
    };
  }

  if (status === 404) {
    return {
      class: 'not_found',
      status,
      message,
      action: 'fail',
      body,
    };
  }

  if (status === 429) {
    return {
      class: 'rate_limited',
      status,
      message,
      action: 'retry',
      hint: 'Throttled. Backing off and retrying with exponential backoff.',
      body,
    };
  }

  if (status >= 500) {
    return {
      class: 'server_error',
      status,
      message,
      action: 'retry',
      hint: 'Amazon-side error. Retrying with exponential backoff.',
      body,
    };
  }

  if (status >= 400) {
    return {
      class: 'validation',
      status,
      message,
      action: 'fix_params',
      body,
    };
  }

  return {
    class: 'unknown',
    status,
    message,
    action: 'fail',
    body,
  };
}

function extractMessage(body: unknown): string {
  if (!body || typeof body !== 'object') return String(body ?? '');
  const b = body as Record<string, unknown>;

  // SP-API error shape: { errors: [{ code, message, details }] }
  if (Array.isArray(b.errors) && b.errors.length > 0) {
    const e = b.errors[0] as Record<string, unknown>;
    const parts = [e.code, e.message, e.details].filter(Boolean);
    return parts.join(' — ');
  }

  // Ads API error shape: { code, message, details }
  if (typeof b.message === 'string') {
    return [b.code, b.message].filter(Boolean).join(' — ');
  }

  return JSON.stringify(b);
}
