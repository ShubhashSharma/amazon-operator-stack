/**
 * --prefilled flag support.
 *
 * Reads a .env-shaped file (default: .env.live in the repo root) and pre-populates
 * the SetupState so prompts that already have answers can be skipped silently
 * (each stage detects prefilled data and short-circuits with a "✓ prefilled" log).
 *
 * Used by the Saturday live demo so the on-stage flow takes ~2 min instead of ~30.
 * Also useful for stress-testing the wizard end-to-end without sitting through every
 * prompt manually.
 *
 * The prefill file should look like a normal .env. Minimum required for skipping
 * stages 4 + 5 is SP_API_CLIENT_ID, SP_API_CLIENT_SECRET, SP_API_REFRESH_TOKEN.
 * For skipping stages 2 + 3 add SP_API_REGION, SP_API_MARKETPLACE_ID, and
 * optionally SP_API_ENABLED_MARKETPLACE_IDS.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findMarketplace, REGIONS } from './marketplaces.js';
import type { SetupState } from './state.js';

export interface PrefillResult {
  state: SetupState;
  prefillFilePath: string;
  prefilled: {
    region: boolean;
    marketplace: boolean;
    spApi: boolean;
  };
}

/**
 * Apply prefill data on top of an existing state. The existing state's
 * lastCompletedStage is kept (we don't pretend stages were completed —
 * we let each stage detect its own prefilled data and short-circuit).
 */
export function loadPrefill(
  repoRoot: string,
  flagValue: string | true,
  baseState: SetupState,
): PrefillResult {
  const filePath =
    typeof flagValue === 'string' && flagValue.length > 0
      ? join(repoRoot, flagValue)
      : join(repoRoot, '.env.live');

  if (!existsSync(filePath)) {
    throw new Error(
      `--prefilled was passed but ${filePath} does not exist. ` +
      `Create the file (a normal .env-shaped file with SP_API_* values) and re-run.`,
    );
  }

  const env = parseEnvFile(filePath);
  const result: PrefillResult = {
    state: { ...baseState },
    prefillFilePath: filePath,
    prefilled: { region: false, marketplace: false, spApi: false },
  };

  // Region — must be a known region key
  const regionRaw = env.SP_API_REGION ?? '';
  const regionKey = mapAwsRegionToKey(regionRaw);
  if (regionKey) {
    result.state.region = regionKey;
    result.prefilled.region = true;
  }

  // Primary marketplace
  const primaryId = env.SP_API_MARKETPLACE_ID ?? '';
  if (primaryId) {
    const mp = findMarketplace(primaryId);
    if (mp) {
      result.state.primaryMarketplaceId = mp.id;
      result.state.primaryMarketplaceCode = mp.code;
      result.state.primaryMarketplaceLabel = mp.label;
      result.state.region = mp.region; // override to match marketplace's region
      result.prefilled.marketplace = true;
    }
  }

  // Enabled marketplaces (comma-separated)
  if (env.SP_API_ENABLED_MARKETPLACE_IDS) {
    const ids = env.SP_API_ENABLED_MARKETPLACE_IDS.split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length > 0) result.state.enabledMarketplaceIds = ids;
  } else if (primaryId) {
    result.state.enabledMarketplaceIds = [primaryId];
  }

  // SP-API credentials
  const clientId = env.SP_API_CLIENT_ID ?? '';
  const clientSecret = env.SP_API_CLIENT_SECRET ?? '';
  const refreshToken = env.SP_API_REFRESH_TOKEN ?? '';
  if (clientId && clientSecret && refreshToken) {
    result.state.spApi = {
      appName: env.SP_API_APP_NAME ?? 'Operator Command Centre',
      clientId,
      clientSecret,
      refreshToken,
    };
    result.prefilled.spApi = true;
  }

  return result;
}

function mapAwsRegionToKey(value: string): 'EU' | 'NA' | 'FE' | null {
  if (!value) return null;
  const v = value.trim();
  // Accept either the region key directly or the AWS region string used by SP-API
  if (v === 'EU' || v === 'NA' || v === 'FE') return v;
  for (const [key, cfg] of Object.entries(REGIONS)) {
    if (cfg.spApiAwsRegion === v) return key as 'EU' | 'NA' | 'FE';
  }
  return null;
}

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = readFileSync(path, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}
