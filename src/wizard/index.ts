#!/usr/bin/env node
/**
 * amazon-operator-stack — setup wizard.
 *
 * Walks a delegate from "I have a Seller Central account" to ".env populated,
 * SP-API working, MCP server ready to register with Claude Code".
 *
 * Resumable: every completed stage is written to setup-state.json. If you
 * quit, hit Ctrl+C, or get blocked waiting on Amazon, run "npm run resume"
 * and the wizard picks up at the next stage.
 *
 * Live demo path: pass --prefilled to read a pre-approved set of credentials
 * from a side-loaded secrets file. See SETUP.md for the prefilled flow.
 */

import * as p from '@clack/prompts';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { banner, dim, teal } from './theme.js';
import { loadState, saveState, type SetupState } from './state.js';

import { preflightStage } from './stages/01-preflight.js';
import { regionStage } from './stages/02-region.js';
import { marketplaceStage } from './stages/03-marketplace.js';
import { developerAppStage } from './stages/04-developer-app.js';
import { selfAuthoriseStage } from './stages/05-self-authorize.js';
import { validateStage } from './stages/06-validate.js';
import { finaliseStage } from './stages/07-finalise.js';

const STAGE_ORDER: SetupState['lastCompletedStage'][] = [
  'none',
  'preflight',
  'region',
  'marketplace',
  'developer-app',
  'self-authorize',
  'validate',
  'finalise',
];

async function main(): Promise<void> {
  const repoRoot = findRepoRoot();
  const flags = parseFlags();

  banner();

  // Existing state? Offer resume.
  let state = loadState(repoRoot);
  const isFresh = state.lastCompletedStage === 'none';

  if (!isFresh && !flags.resume) {
    const action = await p.select({
      message: `Found existing setup state (last completed: ${teal(state.lastCompletedStage)}). What now?`,
      options: [
        { value: 'resume', label: 'Resume from where I left off' },
        { value: 'restart', label: 'Start over (back up the existing .env first)' },
      ],
      initialValue: 'resume',
    });
    if (p.isCancel(action)) {
      p.cancel('No problem. Run "npm run setup" again any time.');
      return;
    }
    if (action === 'restart') {
      state = {
        schemaVersion: 1,
        startedAt: new Date().toISOString(),
        lastCompletedStage: 'none',
      };
      saveState(repoRoot, state);
    }
  }

  if (isFresh) {
    p.intro(`${teal('Welcome.')}  ${dim('This takes about 30 minutes from a cold start.')}`);
    p.note(
      [
        `You will:`,
        `  1.  Confirm your machine is ready`,
        `  2.  Pick your Amazon region`,
        `  3.  Pick your marketplaces`,
        `  4.  Register as an Amazon developer (one-time)`,
        `  5.  Authorise the app and copy a refresh token`,
        `  6.  Test that the connection works`,
        `  7.  Save credentials and finish`,
        ``,
        `${dim('We never send your credentials anywhere. They are written to a local .env file alongside this folder, which is git-ignored by default.')}`,
      ].join('\n'),
      'What this wizard does',
    );
  } else {
    p.intro(`${teal('Resuming setup.')}  ${dim('Picking up at the next stage.')}`);
  }

  // Run each stage in order, skipping ones already completed
  state = await runStageIfPending(state, 'preflight', () => preflightStage(state), repoRoot);
  state = await runStageIfPending(state, 'region', () => regionStage(state), repoRoot);
  state = await runStageIfPending(state, 'marketplace', () => marketplaceStage(state), repoRoot);
  state = await runStageIfPending(state, 'developer-app', () => developerAppStage(state), repoRoot);
  state = await runStageIfPending(state, 'self-authorize', () => selfAuthoriseStage(state), repoRoot);
  state = await runStageIfPending(state, 'validate', () => validateStage(state), repoRoot);
  state = await runStageIfPending(state, 'finalise', () => finaliseStage(state, repoRoot), repoRoot);

  p.outro(`${teal('Setup complete.')}  ${dim('Run "npm run wire-claude" next to register the server with Claude Code.')}`);
}

async function runStageIfPending(
  state: SetupState,
  stage: NonNullable<SetupState['lastCompletedStage']>,
  fn: () => Promise<SetupState>,
  repoRoot: string,
): Promise<SetupState> {
  const completedIdx = STAGE_ORDER.indexOf(state.lastCompletedStage);
  const stageIdx = STAGE_ORDER.indexOf(stage);
  if (completedIdx >= stageIdx) return state;

  const next = await fn();
  saveState(repoRoot, next);
  return next;
}

function parseFlags(): { resume: boolean; prefilled: boolean } {
  const args = process.argv.slice(2);
  return {
    resume: args.includes('--resume'),
    prefilled: args.includes('--prefilled'),
  };
}

function findRepoRoot(): string {
  // src/wizard/index.ts → src/wizard → src → repo root
  // dist/wizard/index.js → dist/wizard → dist → repo root
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..');
}

main().catch(err => {
  console.error('\nSetup failed.');
  console.error(err);
  process.exit(1);
});
