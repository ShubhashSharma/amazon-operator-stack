/**
 * Step 5 — Self-authorise the app to get a refresh token.
 *
 * For self-authorised SP-API apps the dance is dead simple:
 *   1. Click "Authorize" next to your app in the developer console
 *   2. Amazon shows a one-time refresh token on screen
 *   3. Paste it here
 *
 * No callback URL, no OAuth redirect, no AWS IAM. The refresh token never
 * expires unless revoked.
 */

import * as p from '@clack/prompts';
import { stageHeader, explainStage, dim, teal } from '../theme.js';
import type { SetupState } from '../state.js';

export async function selfAuthoriseStage(state: SetupState): Promise<SetupState> {
  stageHeader(5, 7, 'Authorise the app and capture the refresh token');

  if (!state.spApi) {
    throw new Error('SP-API credentials missing. Re-run setup from the start.');
  }

  if (state.spApi.refreshToken) {
    p.log.success(`${teal('✓ prefilled:')} refresh token loaded`);
    return { ...state, lastCompletedStage: 'self-authorize' };
  }

  explainStage(
    'A refresh token lets the MCP server talk to your seller account. Amazon gives you one when you click "Authorize" on your own app — no redirect, no callback, just one screen.',
    'You click Authorize, copy the long token Amazon shows you, paste it here. Then we save everything to .env.',
  );

  p.note(
    [
      `1. Go back to  ${teal('Seller Central → Apps & Services → Develop Apps')}.`,
      '',
      `2. On your app row, click  ${teal('"Authorize"')}.`,
      '',
      `3. Amazon shows a single-page screen with a long string starting with  ${teal('"Atzr|"')}.`,
      `   That is your refresh token. Copy it in full.`,
      '',
      dim('This token is sensitive — treat it like a password. We will save it to a local .env file that is git-ignored.'),
    ].join('\n'),
    'How to get the refresh token',
  );

  const refreshToken = await p.password({
    message: 'Paste your SP-API refresh token:',
    validate: v => {
      if (!v) return 'Refresh token is required.';
      if (!v.startsWith('Atzr|')) return 'That does not look right. The refresh token starts with "Atzr|".';
      if (v.length < 100) return 'That looks too short. Refresh tokens are very long.';
      return undefined;
    },
  });
  if (p.isCancel(refreshToken)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  return {
    ...state,
    spApi: {
      ...state.spApi,
      refreshToken: refreshToken as string,
    },
    lastCompletedStage: 'self-authorize',
  };
}
