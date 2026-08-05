/**
 * Reads and validates the .env config the installer wrote.
 * Throws fast on missing required vars so we don't fail mid-call with cryptic errors.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Config {
  spApi: {
    clientId:     string;
    clientSecret: string;
    refreshToken: string;
    marketplaceId:string;
    enabledMarketplaceIds: string[];
    region:       string;
    endpoint:     string;
  };
  /** Ads API may be unconfigured — homework for delegates to wire later. */
  adsApi: {
    configured:   boolean;
    clientId?:    string;
    clientSecret?:string;
    refreshToken?:string;
    region?:      string;
    endpoint?:    string;
    profileId?:   string;
  };
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

let cached: Config | null = null;

export function loadConfig(): Config {
  if (cached) return cached;

  // Load the repo's .env unconditionally — loadDotenv never overrides vars
  // already in process.env, so explicit exports still win per-key. Gating
  // this on a single variable meant one stray SP_API_CLIENT_ID in a shell
  // profile skipped the .env entirely (crash or, worse, another account's
  // credentials). Since v1.0.1 the .env file is the ONLY place credentials
  // live — the Claude Code MCP entry carries none.
  const envPath = findEnvFile();
  if (envPath) loadDotenv(envPath);

  const required = (k: string) => {
    const v = process.env[k];
    if (!v) throw new Error(
      `Missing required env var: ${k}. Re-run "npm run setup" to populate your .env file.`,
    );
    return v;
  };

  const enabledRaw = process.env.SP_API_ENABLED_MARKETPLACE_IDS ?? '';
  const enabledIds = enabledRaw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  // Ads API is optional — only mark configured if all four required vars look real
  const adsClientId = process.env.ADS_API_CLIENT_ID;
  const adsClientSecret = process.env.ADS_API_CLIENT_SECRET;
  const adsRefreshToken = process.env.ADS_API_REFRESH_TOKEN;
  const adsEndpoint = process.env.ADS_API_ENDPOINT;
  const adsConfigured =
    !!adsClientId && adsClientId !== 'not-configured' &&
    !!adsClientSecret && adsClientSecret !== 'not-configured' &&
    !!adsRefreshToken && adsRefreshToken !== 'not-configured' &&
    !!adsEndpoint;

  const config: Config = {
    spApi: {
      clientId:              required('SP_API_CLIENT_ID'),
      clientSecret:          required('SP_API_CLIENT_SECRET'),
      refreshToken:          required('SP_API_REFRESH_TOKEN'),
      marketplaceId:         required('SP_API_MARKETPLACE_ID'),
      enabledMarketplaceIds: enabledIds.length > 0 ? enabledIds : [required('SP_API_MARKETPLACE_ID')],
      region:                required('SP_API_REGION'),
      endpoint:               required('SP_API_ENDPOINT'),
    },
    adsApi: adsConfigured
      ? {
          configured:   true,
          clientId:     adsClientId,
          clientSecret: adsClientSecret,
          refreshToken: adsRefreshToken,
          region:       process.env.ADS_API_REGION,
          endpoint:     adsEndpoint,
          profileId:    process.env.ADS_PROFILE_ID || undefined,
        }
      : { configured: false },
    logLevel: (process.env.LOG_LEVEL as Config['logLevel']) || 'info',
  };

  cached = config;
  return config;
}

/**
 * Walk up from this module to the first directory containing package.json
 * (the repo root, whether running from dist/ or src/), and use ITS .env or
 * nothing. Continuing past the repo root could land on an unrelated
 * $HOME/.env or a monorepo parent's — silently booting on foreign
 * credentials is far worse than a clean "missing env var" error.
 */
function findEnvFile(): string | null {
  const start = dirname(fileURLToPath(import.meta.url));
  let dir = start;
  for (let i = 0; i < 6; i++) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      const candidate = join(dir, '.env');
      return existsSync(candidate) ? candidate : null;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function loadDotenv(path: string): void {
  const raw = readFileSync(path, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = stripQuotes(trimmed.slice(eq + 1).trim());
    if (!process.env[key]) process.env[key] = value;
  }
}

/**
 * Hand-edited .env files often carry dotenv-style quotes. Keeping them in
 * the value produces credentials that fail live with a misleading
 * "revoked token" diagnosis, so strip one matching surrounding pair.
 */
export function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    if ((first === '"' || first === "'") && value.endsWith(first)) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/** Stderr logger — never write to stdout, that's the MCP transport. */
export function log(level: Config['logLevel'], ...args: unknown[]): void {
  const cfg = cached;
  const order = { debug: 0, info: 1, warn: 2, error: 3 };
  if (cfg && order[level] < order[cfg.logLevel]) return;
  // MCP servers communicate over stdout; logs MUST go to stderr.
  console.error(`[${new Date().toISOString()}] [${level}]`, ...args);
}
