#!/usr/bin/env node
/**
 * End-to-end health check for the amazon-operator-stack install.
 *
 * The v1.0.0 probe matrix could show "5/5 green" while the server was never
 * registered with Claude Code at all — it tested one layer and green-lit
 * another. Doctor checks every layer, in order, and stops at the first
 * failure with a specific fix, because everything downstream of a broken
 * layer fails for that reason and not its own:
 *
 *   1. Registered   — does Claude Code's user config actually list us?
 *   2. Spawnable    — does the registered command start and answer an MCP
 *                     initialize handshake? (no network involved)
 *   3. Credentials  — is .env present, owner-only, and complete?
 *   4. Amazon       — does the refresh token still buy an access token, and
 *                     does one cheap SP-API call succeed?
 *
 * Usage:  npm run doctor          Exit 0 = every layer green.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dim, teal } from './wizard/theme.js';

const SERVER_NAME = 'amazon-operator-stack';
const IS_WINDOWS = process.platform === 'win32';

interface McpServerEntry { command: string; args?: string[]; env?: Record<string, string> }

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(repoRoot, '.env');
const distEntry = join(repoRoot, 'dist', 'server.js');

async function main(): Promise<void> {
  console.log('');
  console.log(`${teal(SERVER_NAME)} ${dim('— doctor')}`);
  if (process.env.CLAUDECODE) {
    console.log(dim('(running inside a Claude Code session — results are still valid, but the'));
    console.log(dim(' session only picks up registration changes after a full restart)'));
  }
  console.log('');

  const entry = checkRegistered();
  await checkSpawnable(entry);
  const env = checkCredentialsFile();
  await checkAmazon(env);

  console.log('');
  console.log(`${teal('All four layers green.')} If Claude Code still doesn't show the tools, restart it — registration is read at startup.`);
  console.log('');
}

// ── Layer 1: registered ──────────────────────────────────────────────────

function checkRegistered(): McpServerEntry {
  const layer = ' 1. Registered with Claude Code';

  // Read the user config directly — no CLI dependency, no server spawning.
  const userConfigPath = join(homedir(), '.claude.json');
  let entry: McpServerEntry | undefined;
  if (existsSync(userConfigPath)) {
    try {
      const config = JSON.parse(readFileSync(userConfigPath, 'utf8'));
      entry = config?.mcpServers?.[SERVER_NAME];
    } catch { /* fall through to failure below */ }
  }

  // A v1.0.0 install wrote to settings.json instead — call that out precisely.
  const legacyPath = join(homedir(), '.claude', 'settings.json');
  let legacyPresent = false;
  if (!entry && existsSync(legacyPath)) {
    try {
      legacyPresent = !!JSON.parse(readFileSync(legacyPath, 'utf8'))?.mcpServers?.[SERVER_NAME];
    } catch { /* ignore */ }
  }

  if (!entry) {
    if (legacyPresent) {
      fail(layer, `found only the old v1.0.0 entry in ~/.claude/settings.json, which Claude Code does not load servers from`,
        `Run "npm run wire-claude" — it migrates the old entry (credentials included) and registers properly.`);
    }
    fail(layer, `no "${SERVER_NAME}" entry in ~/.claude.json (user scope)`,
      `Run "npm run wire-claude".`);
  }

  if (entry.env && Object.keys(entry.env).length > 0) {
    warn(layer, `the registered entry still carries credentials in its env block (v1.0.0 style)`,
      `Re-run "npm run wire-claude" — v1.0.1 keeps credentials in .env only.`);
  }

  const registeredScript = entry.args?.[0] ?? '';
  if (registeredScript !== distEntry) {
    fail(layer, `the entry points at\n      ${registeredScript || '(nothing)'}\n    but this repo builds to\n      ${distEntry}\n    (moved or re-cloned the folder?)`,
      `Run "npm run wire-claude" from this folder to re-point it.`);
  }

  pass(layer, 'user scope, points at this repo');
  return entry;
}

// ── Layer 2: spawnable ───────────────────────────────────────────────────

async function checkSpawnable(entry: McpServerEntry): Promise<void> {
  const layer = ' 2. Server starts and speaks MCP';

  if (!existsSync(distEntry)) {
    fail(layer, `no build at ${distEntry}`, `Run "npm run build".`);
  }
  if (!existsSync(entry.command)) {
    fail(layer, `the registered Node binary is gone:\n      ${entry.command}\n    (Node was upgraded or removed since wiring)`,
      `Run "npm run wire-claude" to re-pin the current Node.`);
  }

  const result = await mcpHandshake(entry.command, entry.args ?? []);
  if (!result.ok) {
    fail(layer, `the server did not answer an MCP initialize within 8s.\n    stderr said:\n${indent(result.stderr || '(nothing)', 6)}`,
      `The stderr above is the actual reason. Most common: .env problems — check layer 3 by hand ("npm run doctor" re-run after fixing).`);
  }
  pass(layer, 'initialize handshake answered');
}

function mcpHandshake(command: string, args: string[]): Promise<{ ok: boolean; stderr: string }> {
  return new Promise(resolvePromise => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      child.kill();
      resolvePromise({ ok, stderr: stderr.trim() });
    };

    const timer = setTimeout(() => finish(false), 8_000);
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
      // Any JSON-RPC result naming our server counts as a successful handshake.
      if (stdout.includes('"serverInfo"') && stdout.includes(SERVER_NAME)) {
        clearTimeout(timer);
        finish(true);
      }
    });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', () => { clearTimeout(timer); finish(false); });
    child.on('exit', () => { clearTimeout(timer); finish(false); });

    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'aos-doctor', version: '1.0.1' },
      },
    }) + '\n');
  });
}

// ── Layer 3: credentials file ────────────────────────────────────────────

function checkCredentialsFile(): Record<string, string> {
  const layer = ' 3. Credentials file (.env)';

  if (!existsSync(envFile)) {
    fail(layer, `no .env at ${envFile}`, `Run "npm run setup".`);
  }

  if (!IS_WINDOWS) {
    const mode = statSync(envFile).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      warn(layer, `.env is readable by other accounts on this machine (mode ${mode.toString(8)})`,
        `Run: chmod 600 ${envFile}`);
    }
  }

  const env: Record<string, string> = {};
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }

  // Mirrors what src/lib/config.ts refuses to start without.
  const required = ['SP_API_CLIENT_ID', 'SP_API_CLIENT_SECRET', 'SP_API_REFRESH_TOKEN', 'SP_API_MARKETPLACE_ID', 'SP_API_REGION', 'SP_API_ENDPOINT'];
  const missing = required.filter(k => !env[k]);
  if (missing.length > 0) {
    fail(layer, `missing: ${missing.join(', ')}`, `Run "npm run setup" (or "npm run resume") to fill them in.`);
  }

  pass(layer, 'present and complete');
  return env;
}

// ── Layer 4: Amazon ──────────────────────────────────────────────────────

async function checkAmazon(env: Record<string, string>): Promise<void> {
  const layer = ' 4. Live call to Amazon';

  let accessToken: string;
  try {
    const res = await fetch('https://api.amazon.com/auth/o2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: env.SP_API_REFRESH_TOKEN,
        client_id: env.SP_API_CLIENT_ID,
        client_secret: env.SP_API_CLIENT_SECRET,
      }).toString(),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      fail(layer, `token exchange failed (HTTP ${res.status}: ${body.error_description ?? body.error ?? 'unknown'})`,
        `The refresh token or client secret is wrong or revoked. Re-authorise in Seller Central → Develop Apps, then "npm run resume".`);
    }
    accessToken = ((await res.json()) as { access_token: string }).access_token;
  } catch (err) {
    fail(layer, `could not reach Amazon's token endpoint (${(err as Error).message})`,
      `Check your network / VPN and re-run.`);
  }

  try {
    const res = await fetch(`${env.SP_API_ENDPOINT}/sellers/v1/marketplaceParticipations`, {
      headers: {
        'x-amz-access-token': accessToken!,
        'user-agent': 'amazon-operator-stack/1.0.1 (doctor; Language=Node)',
        accept: 'application/json',
      },
    });
    if (!res.ok) {
      fail(layer, `SP-API answered HTTP ${res.status} on the cheapest endpoint (marketplaceParticipations)`,
        `Run "npm run smoke-test" for the endpoint-by-endpoint breakdown.`);
    }
  } catch (err) {
    fail(layer, `could not reach ${env.SP_API_ENDPOINT} (${(err as Error).message})`,
      `Check your network, and that SP_API_ENDPOINT in .env matches your region.`);
  }

  pass(layer, 'token exchange + one SP-API call succeeded');
}

// ── Reporting ────────────────────────────────────────────────────────────

function pass(layer: string, detail: string): void {
  console.log(`${teal('✓')}${layer}  ${dim('— ' + detail)}`);
}

function warn(layer: string, problem: string, fix: string): void {
  console.log(`!${layer}`);
  console.log(`    ${problem}`);
  console.log(`    ${dim('Fix:')} ${fix}`);
}

function fail(layer: string, problem: string, fix: string): never {
  console.log(`✗${layer}`);
  console.log(`    ${problem}`);
  console.log('');
  console.log(`    ${teal('Fix:')} ${fix}`);
  console.log('');
  console.log(dim('    (later layers not checked — they would fail because of this one)'));
  console.log('');
  process.exit(1);
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text.split('\n').map(l => pad + l).join('\n');
}

main().catch(err => {
  console.error('\nDoctor crashed (this is a bug in doctor, not necessarily your install):');
  console.error(err);
  process.exit(1);
});
