/**
 * Step 1 — Pre-flight checks.
 *
 * We warn but never block. The delegate decides whether to proceed.
 * Reason: a missing prerequisite is usually fixable in 30 seconds, and a
 * blocking wizard is more frustrating than a soft warning.
 */

import * as p from '@clack/prompts';
import { createServer } from 'node:net';
import { stageHeader, explainStage, dim, teal } from '../theme.js';
import type { SetupState } from '../state.js';

export async function preflightStage(state: SetupState): Promise<SetupState> {
  stageHeader(1, 7, 'Pre-flight checks');

  explainStage(
    'We make sure your machine has what we need before asking you to do anything in Seller Central.',
    'A handful of quick checks. If anything fails we tell you, but you can still continue.',
  );

  const checks = await runChecks();

  for (const check of checks) {
    if (check.ok) {
      p.log.success(`${check.label}  ${dim(check.detail ?? '')}`);
    } else {
      p.log.warn(`${check.label}  ${dim(check.detail ?? '')}`);
    }
  }

  const anyFailed = checks.some(c => !c.ok);
  if (anyFailed) {
    const cont = await p.confirm({
      message: 'Some checks reported warnings. Continue anyway?',
      initialValue: true,
    });
    if (p.isCancel(cont) || cont === false) {
      p.cancel('Stopped before SP-API setup. Fix the warnings above and re-run "npm run setup".');
      process.exit(0);
    }
  } else {
    p.log.message(teal('All checks passed.'));
  }

  return { ...state, lastCompletedStage: 'preflight' };
}

interface Check {
  label: string;
  ok: boolean;
  detail?: string;
}

async function runChecks(): Promise<Check[]> {
  const checks: Check[] = [];

  // Node version
  const major = parseInt(process.versions.node.split('.')[0], 10);
  checks.push({
    label: 'Node.js 20 or newer',
    ok: major >= 20,
    detail: major >= 20
      ? `Node ${process.versions.node}`
      : `Node ${process.versions.node} found. Install Node 20+ from https://nodejs.org`,
  });

  // Operating system
  const platform = process.platform;
  const supported = platform === 'darwin' || platform === 'win32' || platform === 'linux';
  checks.push({
    label: 'Supported operating system',
    ok: supported,
    detail: `Running on ${platform}`,
  });

  // Port 3000 (used for the Ads API OAuth callback later — homework, but worth flagging now)
  const portFree = await isPortFree(3000);
  checks.push({
    label: 'Port 3000 available (used later for Ads API)',
    ok: portFree,
    detail: portFree
      ? 'Free'
      : 'In use by another app. The wizard will fall back to a different port if needed.',
  });

  // Internet check — try to resolve a known Amazon endpoint
  const internet = await canReachAmazon();
  checks.push({
    label: 'Internet connection to Amazon APIs',
    ok: internet,
    detail: internet ? 'Reachable' : 'Cannot reach api.amazon.com — check your connection',
  });

  return checks;
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function canReachAmazon(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch('https://api.amazon.com/auth/o2/token', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=invalid',
    });
    clearTimeout(timeout);
    // Any HTTP response (even 4xx) means we can reach Amazon
    return res.status > 0;
  } catch {
    return false;
  }
}
