/**
 * Ads API authentication via OAuth 2.0 refresh tokens.
 *
 * Ads API uses LWA underneath but the scopes and profile model differ from SP-API:
 *   - Tokens are scoped to "advertising::campaign_management"
 *   - Every request needs an Amazon-Advertising-API-Scope header set to a profile_id
 *   - Profile = ad account in a marketplace; one LWA token can serve many profiles
 *
 * On first call we list profiles, pick the one matching our config (or first if
 * unconfigured), and cache it.
 */

import { loadConfig, log } from '../lib/config.js';
import { ensureOk } from '../lib/retry.js';

interface AdsTokenCache {
  token:     string;
  expiresAt: number;
}

interface AdsProfile {
  profileId:    number;
  countryCode:  string;
  currencyCode: string;
  accountInfo: {
    marketplaceStringId?: string;
    id?: string;
    type?: string;
    name?: string;
  };
}

let tokenCache: AdsTokenCache | null = null;
let profileCache: number | null = null;

const ADS_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

/**
 * Get a valid Ads API access token, refreshing if needed.
 */
export async function getAdsApiAccessToken(): Promise<string> {
  const cfg = loadConfig().adsApi;

  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }

  log('debug', 'Refreshing Ads API access token');

  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: cfg.refreshToken,
    client_id:     cfg.clientId,
    client_secret: cfg.clientSecret,
  });

  const res = await fetch(ADS_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  const data = (await ensureOk(res)) as {
    access_token: string;
    expires_in:   number;
  };

  tokenCache = {
    token:     data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  log('debug', `Ads API token refreshed; expires in ${data.expires_in}s`);
  return tokenCache.token;
}

/**
 * Get the active Ads profile_id, looking it up on first call.
 * Caller config can pin one explicitly via ADS_PROFILE_ID.
 */
export async function getAdsProfileId(): Promise<number> {
  if (profileCache !== null) return profileCache;

  const cfg = loadConfig();
  if (cfg.adsApi.profileId) {
    profileCache = parseInt(cfg.adsApi.profileId, 10);
    return profileCache;
  }

  log('info', 'No ADS_PROFILE_ID configured; fetching profile list to pick the first matching marketplace');

  const token = await getAdsApiAccessToken();
  const res = await fetch(`${cfg.adsApi.endpoint}/v2/profiles`, {
    headers: {
      Authorization:           `Bearer ${token}`,
      'Amazon-Advertising-API-ClientId': cfg.adsApi.clientId,
      Accept:                  'application/json',
    },
  });

  const profiles = (await ensureOk(res)) as AdsProfile[];

  if (!Array.isArray(profiles) || profiles.length === 0) {
    throw new Error(
      'No Ads profiles found. Ensure your Ads API app has been authorised against an account ' +
      'with at least one ad campaign in the configured region.',
    );
  }

  // Try to find one matching the SP-API marketplace, else take the first
  const spMarketplace = cfg.spApi.marketplaceId;
  const matching = profiles.find(
    p => p.accountInfo.marketplaceStringId === spMarketplace,
  );
  const picked = matching ?? profiles[0];

  profileCache = picked.profileId;
  log('info', `Using Ads profile ${picked.profileId} (${picked.accountInfo.name ?? 'unnamed'}, ${picked.countryCode})`);

  return profileCache;
}

/**
 * Build headers for an authenticated Ads API request.
 */
export async function adsApiHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const cfg = loadConfig().adsApi;
  const [token, profileId] = await Promise.all([
    getAdsApiAccessToken(),
    getAdsProfileId(),
  ]);

  return {
    Authorization:                       `Bearer ${token}`,
    'Amazon-Advertising-API-ClientId':   cfg.clientId,
    'Amazon-Advertising-API-Scope':      String(profileId),
    Accept:                              'application/json',
    'Content-Type':                      'application/json',
    'User-Agent':                        'mcp-amazon/0.1 (Seller Sessions Live 2026)',
    ...extra,
  };
}

export function clearAdsCache(): void {
  tokenCache   = null;
  profileCache = null;
}
