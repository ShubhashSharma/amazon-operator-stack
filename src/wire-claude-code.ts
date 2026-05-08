#!/usr/bin/env node
/**
 * Register the amazon-operator-stack MCP server with Claude Code.
 *
 * Adds an entry to ~/.claude/settings.json (or .claude.json) under mcpServers.
 * Claude Code reads this on startup. After running this, restart Claude Code
 * and the new tools appear automatically.
 *
 * We never overwrite existing MCP entries — additive only. If an entry called
 * "amazon-operator-stack" already exists, we update it in place. Other entries
 * are untouched.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dim, teal } from './wizard/theme.js';

interface ClaudeSettings {
  mcpServers?: Record<string, McpServerEntry>;
  [key: string]: unknown;
}

interface McpServerEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

async function main(): Promise<void> {
  const repoRoot = findRepoRoot();
  const envFile = join(repoRoot, '.env');
  const serverEntry = join(repoRoot, 'dist', 'server.js');

  console.log('');
  console.log(`${teal('Registering amazon-operator-stack with Claude Code')}`);
  console.log('');

  if (!existsSync(envFile)) {
    console.error(`✗ No .env found at ${envFile}`);
    console.error(`  Run "npm run setup" first to generate credentials.`);
    process.exit(1);
  }

  if (!existsSync(serverEntry)) {
    console.error(`✗ Server not built. Run "npm run build" first.`);
    process.exit(1);
  }

  const settingsPath = resolveSettingsPath();
  const settings = loadSettings(settingsPath);

  // Back up before mutating
  if (existsSync(settingsPath)) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `${settingsPath}.bak.${ts}`;
    copyFileSync(settingsPath, backup);
    console.log(`${dim('Existing settings backed up to')}  ${backup}`);
  }

  // Read the .env so we can pass each var explicitly into the server's env
  const envVars = readEnvFile(envFile);

  if (!settings.mcpServers) settings.mcpServers = {};

  const existing = settings.mcpServers['amazon-operator-stack'];
  settings.mcpServers['amazon-operator-stack'] = {
    command: 'node',
    args: [serverEntry],
    env: envVars,
  };

  // Ensure directory exists, then write
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');

  if (existing) {
    console.log(`${teal('✓')} Updated existing entry in ${settingsPath}`);
  } else {
    console.log(`${teal('✓')} Added entry to ${settingsPath}`);
  }

  console.log('');
  console.log(`${teal('Next:')}  Restart Claude Code (or run "claude" again).`);
  console.log(`        Then ask:  "list my amazon orders from the last 7 days"`);
  console.log('');
}

function resolveSettingsPath(): string {
  // Claude Code looks for either of these. Prefer ~/.claude/settings.json.
  const primary = join(homedir(), '.claude', 'settings.json');
  const legacy = join(homedir(), '.claude.json');
  if (existsSync(primary)) return primary;
  if (existsSync(legacy)) return legacy;
  return primary; // fresh install — write to the modern location
}

function loadSettings(path: string): ClaudeSettings {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ClaudeSettings;
  } catch {
    console.error(`✗ Could not parse ${path} as JSON.`);
    console.error(`  Refusing to overwrite. Fix the file by hand or delete it and re-run.`);
    process.exit(1);
  }
}

function readEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = readFileSync(path, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && value) out[key] = value;
  }
  return out;
}

function findRepoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..');
}

main().catch(err => {
  console.error('\nWire-up failed.');
  console.error(err);
  process.exit(1);
});
