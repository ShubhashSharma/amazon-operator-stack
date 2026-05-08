/**
 * Visual theme for the wizard — keeps the not a square aesthetic.
 *
 * Two colours only: teal for accent, muted grey for secondary text.
 * Rest is plain. Restraint is the brand.
 */

import * as p from '@clack/prompts';

const TEAL = '\x1b[38;2;6;182;212m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

export function teal(text: string): string {
  return `${TEAL}${text}${RESET}`;
}

export function dim(text: string): string {
  return `${DIM}${text}${RESET}`;
}

/**
 * The opening banner. Shown once at the top of the wizard.
 * Compact, branded, free of jargon.
 */
export function banner(): void {
  const lines = [
    '',
    teal('  amazon-operator-stack'),
    dim('  by not a square'),
    '',
    '  Connect your Amazon seller account to Claude Code.',
    '',
  ];
  console.log(lines.join('\n'));
}

/**
 * Section header inside the wizard. Shown at the start of each stage.
 */
export function stageHeader(stageNumber: number, totalStages: number, title: string): void {
  console.log('');
  console.log(`${teal(`Step ${stageNumber} of ${totalStages}`)}  ${title}`);
  console.log(dim('─'.repeat(60)));
}

/**
 * Show the "why we ask / what happens next" framing for a stage.
 * Plain prose, no bullets, two short paragraphs.
 */
export function explainStage(why: string, next: string): void {
  p.note(
    `${dim('Why we ask:')}  ${why}\n\n${dim('What happens next:')}  ${next}`,
    teal('About this step'),
  );
}

/**
 * Closing summary block at the end of a successful wizard run.
 */
export function finaleSummary(opts: {
  marketplace: string;
  envFilePath: string;
  toolsAvailable: number;
}): void {
  console.log('');
  p.note(
    [
      `${teal('Done.')} Your Amazon seller account is connected.`,
      '',
      `Primary marketplace:  ${opts.marketplace}`,
      `Credentials saved at: ${opts.envFilePath}`,
      `Tools available:      ${opts.toolsAvailable}`,
      '',
      `Next:  ${teal('npm run wire-claude')}    Register the server with Claude Code`,
      `       ${teal('npm run smoke-test')}    Re-run the probe matrix any time`,
      `       ${teal('open HOMEWORK.md')}      Pick up Ads API + write capabilities`,
    ].join('\n'),
    'You\'re all set',
  );
}
