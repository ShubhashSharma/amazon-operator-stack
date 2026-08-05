#!/usr/bin/env node
/**
 * Register the amazon-operator-stack MCP server with Claude Code.
 *
 * Registration goes through the `claude mcp` CLI (user scope, ~/.claude.json)
 * rather than hand-writing any config file. Two rules this script lives by:
 *
 *   1. Credentials never leave .env. The registered entry is command + args
 *      only — the server loads .env itself (see src/lib/config.ts). Nothing
 *      sensitive lands in ~/.claude.json, in backups, or in `claude mcp get`
 *      output.
 *   2. Success is verified, not assumed. We confirm the entry with
 *      `claude mcp get` after writing, and exit non-zero if it isn't there.
 *
 * Also migrates installs wired by v1.0.0, which wrote an mcpServers block
 * (including credentials) into ~/.claude/settings.json — a file Claude Code
 * does not read server definitions from. Credentials found there are merged
 * into .env BEFORE the dead entry is removed, so nothing is ever lost.
 *
 * Flags:  --dry-run   print what would happen, change nothing
 */

import {
  existsSync, readFileSync, writeFileSync, chmodSync, readdirSync, statSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dim, teal } from './wizard/theme.js';

const SERVER_NAME = 'amazon-operator-stack';
const IS_WINDOWS = process.platform === 'win32';
const DRY_RUN = process.argv.includes('--dry-run');

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
  console.log(teal(`Registering ${SERVER_NAME} with Claude Code`) + (DRY_RUN ? dim('  (dry run)') : ''));
  console.log('');

  // ── Preflight ──────────────────────────────────────────────────────────

  warnIfSyncedPath(repoRoot);

  if (!existsSync(envFile)) {
    fail(`No .env found at ${envFile}`, `Run "npm run setup" first to generate credentials.`);
  }

  if (!existsSync(serverEntry)) {
    console.log(`${dim('No build found. Running')} ${teal('npm run build')} ${dim('for you...')}`);
    if (!DRY_RUN) {
      const buildResult = spawnSync('npm', ['run', 'build'], {
        cwd: repoRoot, stdio: 'inherit', shell: IS_WINDOWS,
      });
      if (buildResult.status !== 0 || !existsSync(serverEntry)) {
        fail('Build failed.', 'Fix the errors above and re-run "npm run wire-claude".');
      }
      console.log(`${teal('✓')} Built ${serverEntry}`);
    }
  }

  const claude = findClaudeCli();
  if (!claude) {
    console.error(`✗ The "claude" CLI is not on this shell's PATH, so I can't register the server for you.`);
    console.error('');
    console.error(`  If Claude Code is installed, open the terminal you normally run "claude" from and run:`);
    console.error('');
    console.error(`    ${manualCommand(serverEntry)}`);
    console.error('');
    console.error(`  If it isn't installed yet: https://claude.com/claude-code`);
    process.exit(1);
  }
  console.log(`${dim('Claude Code CLI:')} ${claude.version}`);

  // ── Migrate any v1.0.0 wiring out of ~/.claude/settings.json ──────────

  migrateLegacySettings(envFile);

  // ── Register (user scope, no credentials in the entry) ─────────────────

  // process.execPath = the exact Node binary running this script. Claude
  // Code spawns servers with its own PATH, which for nvm/homebrew setups
  // can resolve a different (or no) Node. Pin it.
  //
  // Positional "mcp add" rather than "add-json": no JSON travelling through
  // cmd.exe quoting on Windows, and no env block — credentials stay in .env.
  const addArgs = ['mcp', 'add', SERVER_NAME, process.execPath, serverEntry, '--scope', 'user'];

  if (DRY_RUN) {
    console.log(`${dim('Would run:')} claude ${addArgs.join(' ')}`);
  } else {
    // "mcp add" refuses duplicates — remove first so re-runs update cleanly.
    runClaude(['mcp', 'remove', SERVER_NAME, '--scope', 'user'], true);
    runClaude(['mcp', 'remove', SERVER_NAME, '--scope', 'local'], true);
    const add = runClaude(addArgs);
    if (add.status !== 0) {
      fail(`"claude mcp add" failed:\n${add.output}`,
        `Register manually with:\n\n    ${manualCommand(serverEntry)}`);
    }
  }

  // ── Verify — report on the outcome, not the write ──────────────────────

  if (!DRY_RUN) {
    // Exit code is the registration check ("mcp get" exits 1 on a missing
    // server). The path is asserted against the config file directly — the
    // CLI's human-readable output doesn't include args on every version.
    const get = runClaude(['mcp', 'get', SERVER_NAME]);
    if (get.status !== 0) {
      fail(`Registration could not be verified — "claude mcp get ${SERVER_NAME}" does not show this server.`,
        `Register manually with:\n\n    ${manualCommand(serverEntry)}\n\n  then run "npm run doctor".`);
    }
    const registered = readUserScopeEntry();
    if (registered && registered.args?.[0] !== serverEntry) {
      fail(`A "${SERVER_NAME}" entry exists but points at\n    ${registered.args?.[0] ?? '(nothing)'}\n  instead of this repo's build.`,
        `Register manually with:\n\n    ${manualCommand(serverEntry)}\n\n  then run "npm run doctor".`);
    }
    if (/Failed to connect/i.test(get.output)) {
      console.log(`${teal('✓')} Registered, but the server failed its first health check.`);
      console.log(`  Run ${teal('npm run doctor')} — it will tell you which layer is unhappy.`);
    } else {
      console.log(`${teal('✓')} Registered and verified (user scope, all your projects).`);
    }
  }

  // ── Next steps — different if we're inside a Claude Code session ───────

  console.log('');
  if (process.env.CLAUDECODE) {
    console.log(`${teal('Important:')} this command ran INSIDE a Claude Code session.`);
    console.log(`  The running session can overwrite MCP registrations when it exits.`);
    console.log('');
    console.log(`  1. Fully quit Claude Code (all sessions).`);
    console.log(`  2. In a fresh terminal:  cd ${shellQuote(dirname(envFile))} && npm run doctor`);
    console.log(`  3. Start Claude Code and ask:  "list my amazon orders from the last 7 days"`);
  } else {
    console.log(`${teal('Next:')}  1. Run ${teal('npm run doctor')} to confirm every layer end to end.`);
    console.log(`        2. Restart Claude Code, then ask:  "list my amazon orders from the last 7 days"`);
  }
  console.log('');
}

// ── Legacy migration ─────────────────────────────────────────────────────

/**
 * v1.0.0 wrote { mcpServers: { amazon-operator-stack: { env: <secrets> } } }
 * into ~/.claude/settings.json. Claude Code ignores (or half-recognises,
 * version-depending) that block, and the env carried live credentials.
 *
 * Order matters: credentials are copied into .env FIRST, the entry removed
 * second, so a half-run can never destroy the only copy of a refresh token.
 * Backups the old script created are tightened to 0600, never deleted.
 */
function migrateLegacySettings(envFile: string): void {
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  if (!existsSync(settingsPath)) return;

  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  } catch {
    console.log(`${dim('!')} ${settingsPath} is not valid JSON — skipping legacy check. Fix it by hand if a previous wire-up wrote to it.`);
    return;
  }

  const servers = settings.mcpServers as Record<string, McpServerEntry> | undefined;
  const legacy = servers?.[SERVER_NAME];

  if (legacy) {
    console.log(`${dim('Found a v1.0.0 entry in')} ${settingsPath} ${dim('(a file Claude Code does not read server definitions from).')}`);

    // 1. Copy any credentials from the legacy entry into .env before touching anything.
    if (legacy.env && Object.keys(legacy.env).length > 0) {
      const envVars = readEnvFile(envFile);
      const missing = Object.entries(legacy.env).filter(([k, v]) => v && !envVars[k]);
      if (missing.length > 0 && !DRY_RUN) {
        const addition = ['', '# Recovered from the v1.0.0 Claude Code settings entry during migration',
          ...missing.map(([k, v]) => `${k}=${v}`), ''].join('\n');
        writeFileSync(envFile, readFileSync(envFile, 'utf8') + addition, 'utf8');
        if (!IS_WINDOWS) chmodSync(envFile, 0o600);
        console.log(`${teal('✓')} Copied ${missing.length} credential value(s) from the old entry into .env (0600).`);
      }
    }

    // 2. Only now remove the dead entry.
    if (!DRY_RUN) {
      delete servers![SERVER_NAME];
      if (Object.keys(servers!).length === 0) delete settings.mcpServers;
      const backup = `${settingsPath}.bak.${new Date().toISOString().replace(/[:.]/g, '-')}`;
      writeFileSync(backup, readFileSync(settingsPath), { mode: 0o600, flag: 'wx' });
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
      console.log(`${teal('✓')} Removed the dead entry (backup at ${backup}, owner-only).`);
    } else {
      console.log(`${dim('Would migrate credentials to .env and remove the entry.')}`);
    }
  }

  // 3. Old backups may hold credentials world-readable. Tighten, don't delete.
  if (!IS_WINDOWS) {
    const dir = dirname(settingsPath);
    const staleBackups = [
      ...listBackups(dir, 'settings.json.bak.'),
      ...listBackups(homedir(), '.claude.json.bak.'),
    ];
    let tightened = 0;
    for (const file of staleBackups) {
      try {
        if ((statSync(file).mode & 0o077) !== 0 && !DRY_RUN) { chmodSync(file, 0o600); tightened++; }
      } catch { /* unreadable / gone — nothing to tighten */ }
    }
    if (tightened > 0) {
      console.log(`${teal('✓')} Tightened ${tightened} old backup file(s) to owner-only. Once "npm run doctor" passes, you can delete them:`);
      console.log(`    rm ${shellQuote(join(dir, 'settings.json.bak.'))}* ${shellQuote(join(homedir(), '.claude.json.bak.'))}*`);
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Read our entry straight from ~/.claude.json (user scope). Null if unreadable. */
function readUserScopeEntry(): McpServerEntry | null {
  try {
    const config = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8'));
    return config?.mcpServers?.[SERVER_NAME] ?? null;
  } catch {
    return null;
  }
}

function findClaudeCli(): { version: string } | null {
  const probe = runClaude(['--version']);
  if (probe.status === 0 && probe.output.trim()) return { version: probe.output.trim().split('\n')[0] };
  return null;
}

function runClaude(args: string[], ignoreFailure = false): { status: number; output: string } {
  const result = spawnSync('claude', args, {
    encoding: 'utf8',
    shell: IS_WINDOWS, // resolves claude.cmd on Windows
    timeout: 30_000,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const status = result.status ?? 1;
  if (status !== 0 && !ignoreFailure && result.error) {
    return { status, output: output || String(result.error) };
  }
  return { status, output };
}

function manualCommand(serverEntry: string): string {
  return `claude mcp add ${SERVER_NAME} ${shellQuote(process.execPath)} ${shellQuote(serverEntry)} --scope user`;
}

function warnIfSyncedPath(repoRoot: string): void {
  if (/Mobile Documents|iCloud|Dropbox|OneDrive|Google Drive/i.test(repoRoot)) {
    console.log(`${dim('!')} This repo lives inside a synced folder (iCloud/Dropbox/OneDrive).`);
    console.log(`  Sync services can evict files, which kills the server at random later.`);
    console.log(`  Recommended: move the folder to ~/code/ and re-run this command.`);
    console.log('');
  }
}

function listBackups(dir: string, prefix: string): string[] {
  try {
    return readdirSync(dir)
      .filter(f => f.startsWith(prefix))
      .map(f => join(dir, f));
  } catch {
    return [];
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

function shellQuote(p: string): string {
  return /[\s'"$]/.test(p) ? `"${p}"` : p;
}

function findRepoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..');
}

function fail(problem: string, fix: string): never {
  console.error(`✗ ${problem}`);
  console.error(`  ${fix}`);
  process.exit(1);
}

main().catch(err => {
  console.error('\nWire-up failed.');
  console.error(err);
  process.exit(1);
});
