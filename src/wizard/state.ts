/**
 * Setup state — persisted to setup-state.json so the wizard is resumable.
 *
 * If a delegate quits mid-way (or hits an Amazon-side gate they need to come
 * back from), they can re-run "npm run setup" or "npm run resume" and pick
 * up exactly where they left off.
 *
 * State is written after every completed stage. Never write half-finished
 * stage data — keep the on-disk state consistent.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SetupState {
  /** Schema version — bump if the shape changes. */
  schemaVersion: 1;

  /** Wall clock when the wizard first ran. */
  startedAt: string;

  /** Last completed stage. The wizard resumes at the next one. */
  lastCompletedStage:
    | 'none'
    | 'preflight'
    | 'region'
    | 'marketplace'
    | 'developer-app'
    | 'self-authorize'
    | 'validate'
    | 'finalise';

  /** Selected region (EU / NA / FE). */
  region?: 'EU' | 'NA' | 'FE';

  /** Primary marketplace for this run (the one we test against). */
  primaryMarketplaceId?: string;
  primaryMarketplaceCode?: string;
  primaryMarketplaceLabel?: string;

  /** All marketplaces the seller wants enabled (always includes the primary). */
  enabledMarketplaceIds?: string[];

  /** SP-API LWA app credentials. */
  spApi?: {
    appName: string;
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  };

  /** Probe results from the last validate run. */
  probe?: {
    runAt: string;
    results: ProbeResult[];
  };
}

export interface ProbeResult {
  endpoint: string;
  label: string;
  status: 'ok' | 'role_denied' | 'role_granted_param' | 'gated' | 'error';
  detail?: string;
}

const STATE_FILE = 'setup-state.json';

export function statePath(repoRoot: string): string {
  return join(repoRoot, STATE_FILE);
}

export function loadState(repoRoot: string): SetupState {
  const path = statePath(repoRoot);
  if (!existsSync(path)) {
    return {
      schemaVersion: 1,
      startedAt: new Date().toISOString(),
      lastCompletedStage: 'none',
    };
  }
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as SetupState;
    if (parsed.schemaVersion !== 1) {
      throw new Error(`Unknown setup-state.json schema version: ${parsed.schemaVersion}`);
    }
    return parsed;
  } catch (err) {
    throw new Error(
      `Failed to read ${path}: ${(err as Error).message}\n` +
      `If you want to start fresh, delete the file and re-run "npm run setup".`,
    );
  }
}

export function saveState(repoRoot: string, state: SetupState): void {
  const path = statePath(repoRoot);
  writeFileSync(path, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

export function clearState(repoRoot: string): void {
  const path = statePath(repoRoot);
  if (existsSync(path)) {
    writeFileSync(path, '', 'utf8');
  }
}
