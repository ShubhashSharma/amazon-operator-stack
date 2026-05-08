#!/usr/bin/env node
/**
 * Smoke-test script — re-runs the probe matrix against your existing .env.
 *
 * Useful when:
 *   - You have just granted a new SP-API role and want to confirm it took effect
 *   - You suspect your refresh token has been revoked
 *   - A scheduled report / consultant call needs a quick "everything green?" check
 *
 * Usage:
 *   npm run smoke-test
 *
 * Exits 0 if every probe passed (ok or role_granted_param). Exits 1 otherwise.
 */

import { loadConfig } from './lib/config.js';
import { dim, teal } from './wizard/theme.js';

interface ProbeResult {
  endpoint: string;
  label: string;
  status: 'ok' | 'role_denied' | 'role_granted_param' | 'gated' | 'error';
  detail?: string;
}

async function main(): Promise<void> {
  console.log('');
  console.log(`${teal('amazon-operator-stack')} ${dim('— probe matrix')}`);
  console.log('');

  const cfg = loadConfig();

  console.log(`Marketplace:   ${cfg.spApi.marketplaceId}`);
  console.log(`Endpoint:      ${cfg.spApi.endpoint}`);
  console.log(`Ads API:       ${cfg.adsApi.configured ? teal('configured') : dim('not configured (homework)')}`);
  console.log('');

  // Step 1 — exchange refresh token for access token
  process.stdout.write('Exchanging refresh token...  ');
  let accessToken: string;
  try {
    accessToken = await getAccessToken(cfg);
    console.log(teal('ok'));
  } catch (err) {
    console.log(`✗ ${(err as Error).message}`);
    process.exit(1);
  }

  // Step 2 — run each probe
  const probes = buildProbes(cfg.spApi.marketplaceId);
  const results: ProbeResult[] = [];

  for (const probe of probes) {
    process.stdout.write(`${probe.label.padEnd(34, ' ')}  `);
    const r = await runProbe(probe, accessToken, cfg.spApi.endpoint);
    results.push(r);
    console.log(formatStatus(r));
  }

  console.log('');
  const ok = results.filter(r => r.status === 'ok' || r.status === 'role_granted_param').length;
  const gated = results.filter(r => r.status === 'gated').length;
  const denied = results.filter(r => r.status === 'role_denied').length;
  const errors = results.filter(r => r.status === 'error').length;

  console.log(`${teal(`${ok}/${results.length} working`)}` +
    (gated  ? `, ${gated} gated`   : '') +
    (denied ? `, ${denied} denied` : '') +
    (errors ? `, ${errors} errored`: '') + '\n');

  process.exit(denied > 0 || errors > 0 ? 1 : 0);
}

interface Probe { endpoint: string; label: string; path: string; }

function buildProbes(marketplaceId: string): Probe[] {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  return [
    { endpoint: 'orders/getOrders',                    label: 'Orders (last 24h)',         path: `/orders/v0/orders?MarketplaceIds=${marketplaceId}&CreatedAfter=${since}&MaxResultsPerPage=1` },
    { endpoint: 'fbaInventory/getInventorySummaries',  label: 'FBA Inventory',             path: `/fba/inventory/v1/summaries?marketplaceIds=${marketplaceId}&granularityType=Marketplace&granularityId=${marketplaceId}&details=false` },
    { endpoint: 'finances/listFinancialEvents',        label: 'Finances (last 24h)',       path: `/finances/v0/financialEvents?PostedAfter=${since}&MaxResultsPerPage=1` },
    { endpoint: 'reports/getReports',                  label: 'Reports',                   path: `/reports/2021-06-30/reports?reportTypes=GET_FLAT_FILE_OPEN_LISTINGS_DATA&pageSize=1` },
    { endpoint: 'sellers/getMarketplaceParticipations', label: 'Marketplace participations', path: '/sellers/v1/marketplaceParticipations' },
  ];
}

async function runProbe(probe: Probe, accessToken: string, endpoint: string): Promise<ProbeResult> {
  try {
    const res = await fetch(endpoint + probe.path, {
      headers: {
        'x-amz-access-token': accessToken,
        'user-agent': 'amazon-operator-stack/1.0 (probe; Language=Node)',
        accept: 'application/json',
      },
    });
    if (res.ok) return { endpoint: probe.endpoint, label: probe.label, status: 'ok' };

    const body = await res.json().catch(() => ({}));
    if (res.status === 400) return { endpoint: probe.endpoint, label: probe.label, status: 'role_granted_param', detail: 'role granted (off-spec params; counts as pass)' };
    if (res.status === 403) {
      const message = extractMessage(body);
      const gated = /brand registry|brand analytics/i.test(message);
      return {
        endpoint: probe.endpoint,
        label: probe.label,
        status: gated ? 'gated' : 'role_denied',
        detail: gated ? 'Brand Registry required' : 'role not granted in Develop Apps',
      };
    }
    return { endpoint: probe.endpoint, label: probe.label, status: 'error', detail: `${res.status} — ${extractMessage(body) || 'unknown'}` };
  } catch (err) {
    return { endpoint: probe.endpoint, label: probe.label, status: 'error', detail: (err as Error).message };
  }
}

async function getAccessToken(cfg: ReturnType<typeof loadConfig>): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: cfg.spApi.refreshToken,
    client_id: cfg.spApi.clientId,
    client_secret: cfg.spApi.clientSecret,
  });
  const res = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(`HTTP ${res.status}: ${errBody.error_description ?? errBody.error ?? 'token exchange failed'}`);
  }
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

function extractMessage(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const b = body as Record<string, unknown>;
  if (Array.isArray(b.errors) && b.errors.length > 0) {
    const e = b.errors[0] as Record<string, unknown>;
    return [e.code, e.message, e.details].filter(Boolean).join(' — ');
  }
  if (typeof b.message === 'string') return b.message;
  return '';
}

function formatStatus(r: ProbeResult): string {
  switch (r.status) {
    case 'ok':                  return teal('✓ ok');
    case 'role_granted_param':  return `${teal('✓')} ${dim(r.detail ?? '')}`;
    case 'gated':               return `! ${dim(r.detail ?? '')}`;
    case 'role_denied':         return `✗ ${dim(r.detail ?? '')}`;
    case 'error':               return `✗ ${dim(r.detail ?? '')}`;
  }
}

main().catch(err => {
  console.error('\nProbe failed.');
  console.error(err);
  process.exit(1);
});
