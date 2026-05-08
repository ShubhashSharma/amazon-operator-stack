/**
 * Step 6 — Probe matrix.
 *
 * Hits one canary endpoint per SP-API surface and reports each as:
 *   ok                  — endpoint returned data
 *   role_granted_param  — 400 (role works, params off — count as PASS)
 *   role_denied         — 403 (role missing, the delegate needs to grant it)
 *   gated               — Brand Registry / Brand Analytics required
 *   error               — something else, with hint
 *
 * The 400-vs-403 rule is canonical: a 400 means the role IS granted but our
 * canary call had off-spec params, so it counts as a PASS.
 */

import * as p from '@clack/prompts';
import { stageHeader, explainStage, dim, teal } from '../theme.js';
import { REGIONS } from '../marketplaces.js';
import type { SetupState, ProbeResult } from '../state.js';

export async function validateStage(state: SetupState): Promise<SetupState> {
  stageHeader(6, 7, 'Test that everything works');

  if (!state.spApi || !state.region || !state.primaryMarketplaceId) {
    throw new Error('Missing state. Re-run setup from the start.');
  }

  explainStage(
    'We hit a small set of read-only endpoints to confirm your app has the right roles and your refresh token works.',
    'A green tick means the role is granted. An amber warning means the role exists but the data is gated (Brand Registry needed). A red mark means the role needs adding in Seller Central.',
  );

  const spinner = p.spinner();
  spinner.start('Asking Amazon for an access token...');

  const region = REGIONS[state.region];
  let accessToken: string;
  try {
    accessToken = await getAccessToken(state.spApi);
  } catch (err) {
    spinner.stop('Could not exchange the refresh token for an access token.');
    p.log.error((err as Error).message);
    p.log.warn('Most likely cause: the refresh token was copied incomplete. Re-run "npm run resume" and paste it again.');
    throw err;
  }

  spinner.stop('Access token in hand.');

  const results: ProbeResult[] = [];
  const probes = buildProbes(state.primaryMarketplaceId);

  for (const probe of probes) {
    spinner.start(`Testing ${probe.label}...`);
    const result = await runProbe(probe, accessToken, region.spApiEndpoint);
    results.push(result);
    spinner.stop(formatProbeLine(result));
  }

  const summary = summarise(results);
  p.note(summary, 'Probe matrix results');

  return {
    ...state,
    probe: { runAt: new Date().toISOString(), results },
    lastCompletedStage: 'validate',
  };
}

interface Probe {
  endpoint: string;
  label: string;
  path: string;
}

function buildProbes(marketplaceId: string): Probe[] {
  return [
    {
      endpoint: 'orders/getOrders',
      label: 'Orders (last 24h)',
      path: `/orders/v0/orders?MarketplaceIds=${marketplaceId}&CreatedAfter=${oneDayAgo()}&MaxResultsPerPage=1`,
    },
    {
      endpoint: 'fbaInventory/getInventorySummaries',
      label: 'FBA Inventory',
      path: `/fba/inventory/v1/summaries?marketplaceIds=${marketplaceId}&granularityType=Marketplace&granularityId=${marketplaceId}&details=false`,
    },
    {
      endpoint: 'finances/listFinancialEvents',
      label: 'Finances (last 24h)',
      path: `/finances/v0/financialEvents?PostedAfter=${oneDayAgo()}&MaxResultsPerPage=1`,
    },
    {
      endpoint: 'reports/getReports',
      label: 'Reports',
      path: `/reports/2021-06-30/reports?reportTypes=GET_FLAT_FILE_OPEN_LISTINGS_DATA&pageSize=1`,
    },
    {
      endpoint: 'sellers/getMarketplaceParticipations',
      label: 'Marketplace participations',
      path: '/sellers/v1/marketplaceParticipations',
    },
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

    if (res.ok) {
      return { endpoint: probe.endpoint, label: probe.label, status: 'ok' };
    }

    const body = await res.json().catch(() => ({}));

    // 400 = role granted, params off — count as PASS for probe purposes
    if (res.status === 400) {
      return {
        endpoint: probe.endpoint,
        label: probe.label,
        status: 'role_granted_param',
        detail: 'Role granted (probe used off-spec params; counts as a pass)',
      };
    }

    if (res.status === 403) {
      const message = extractMessage(body);
      const gated = /brand registry|brand analytics/i.test(message);
      return {
        endpoint: probe.endpoint,
        label: probe.label,
        status: gated ? 'gated' : 'role_denied',
        detail: gated
          ? 'Brand Registry required for this data. Skip if you are not brand registered.'
          : 'Role not granted — go to Seller Central → Apps & Services → Develop Apps and add it.',
      };
    }

    return {
      endpoint: probe.endpoint,
      label: probe.label,
      status: 'error',
      detail: `${res.status} — ${extractMessage(body) || 'unknown error'}`,
    };
  } catch (err) {
    return {
      endpoint: probe.endpoint,
      label: probe.label,
      status: 'error',
      detail: (err as Error).message,
    };
  }
}

async function getAccessToken(creds: { clientId: string; clientSecret: string; refreshToken: string }): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: creds.refreshToken,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });

  const res = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(
      `LWA token exchange failed (HTTP ${res.status}): ` +
      (errorBody.error_description ?? errorBody.error ?? 'unknown error'),
    );
  }

  const data = await res.json() as { access_token: string };
  return data.access_token;
}

function oneDayAgo(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
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

function formatProbeLine(r: ProbeResult): string {
  const padded = r.label.padEnd(34, ' ');
  switch (r.status) {
    case 'ok': return `${teal('✓')} ${padded} ${dim('working')}`;
    case 'role_granted_param': return `${teal('✓')} ${padded} ${dim(r.detail ?? 'role granted')}`;
    case 'gated': return `! ${padded} ${dim(r.detail ?? 'gated')}`;
    case 'role_denied': return `✗ ${padded} ${dim(r.detail ?? 'role denied')}`;
    case 'error': return `✗ ${padded} ${dim(r.detail ?? 'error')}`;
  }
}

function summarise(results: ProbeResult[]): string {
  const ok = results.filter(r => r.status === 'ok' || r.status === 'role_granted_param').length;
  const gated = results.filter(r => r.status === 'gated').length;
  const denied = results.filter(r => r.status === 'role_denied').length;
  const errors = results.filter(r => r.status === 'error').length;

  const lines = [
    `${ok}/${results.length} endpoints working`,
    gated > 0 ? `${gated} gated (Brand Registry required)` : '',
    denied > 0 ? `${denied} denied (add the role in Seller Central → Apps & Services)` : '',
    errors > 0 ? `${errors} errored (see detail above; usually transient)` : '',
  ].filter(Boolean);

  return lines.join('\n');
}
