/**
 * SP-API authentication via LWA (Login With Amazon) refresh tokens.
 *
 * Flow:
 *   1. Delegate registers an LWA app in Seller Central (one-time)
 *   2. Delegate authorises the app and captures a refresh_token (one-time, via auth-capture.ts)
 *   3. At call time we exchange refresh_token → access_token, then call SP-API
 *
 * Access tokens are cached for ~55 minutes (Amazon issues 60-min tokens).
 */

import { loadConfig, log } from '../lib/config.js';
import { ensureOk } from '../lib/retry.js';

interface AccessTokenCache {
  token:     string;
  expiresAt: number; // epoch ms
}

let cache: AccessTokenCache | null = null;

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

/**
 * Get a valid SP-API access token, refreshing if needed.
 */
export async function getSpApiAccessToken(): Promise<string> {
  const cfg = loadConfig().spApi;

  // 1 minute safety margin before actual expiry
  if (cache && cache.expiresAt > Date.now() + 60_000) {
    return cache.token;
  }

  log('debug', 'Refreshing SP-API access token');

  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: cfg.refreshToken,
    client_id:     cfg.clientId,
    client_secret: cfg.clientSecret,
  });

  const res = await fetch(LWA_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  const data = (await ensureOk(res)) as {
    access_token: string;
    expires_in:   number;
    token_type:   string;
  };

  cache = {
    token:     data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  log('debug', `SP-API token refreshed; expires in ${data.expires_in}s`);
  return cache.token;
}

/**
 * Build the headers for an authenticated SP-API request.
 *
 * Note: SP-API does NOT require AWS SigV4 signing as of late 2023 —
 * Amazon deprecated that requirement. Just the access token + user-agent.
 */
export async function spApiHeaders(): Promise<Record<string, string>> {
  const token = await getSpApiAccessToken();
  return {
    'x-amz-access-token': token,
    'user-agent':         'mcp-amazon/0.1 (Seller Sessions Live 2026; Language=Node)',
    'accept':             'application/json',
    'content-type':       'application/json',
  };
}

/**
 * Force-clear the token cache. Used after a 401 to retry once with a fresh token.
 */
export function clearSpApiCache(): void {
  cache = null;
}
