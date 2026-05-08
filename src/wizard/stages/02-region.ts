/**
 * Step 2 — Region.
 *
 * Amazon runs three regional endpoints. The seller picks one, which decides
 * which marketplaces are available later. This is the only place a delegate
 * has to think about regions; after this we hide the detail.
 */

import * as p from '@clack/prompts';
import { stageHeader, explainStage } from '../theme.js';
import { REGIONS } from '../marketplaces.js';
import type { SetupState } from '../state.js';

export async function regionStage(state: SetupState): Promise<SetupState> {
  stageHeader(2, 7, 'Pick your Amazon region');

  explainStage(
    'Amazon runs three regional clouds. Your Seller Central account lives in one of them, and we need to talk to the matching one.',
    'You pick the region. We use it to choose the right endpoints for the rest of the setup.',
  );

  const region = await p.select({
    message: 'Which region is your Seller Central account in?',
    options: [
      { value: 'EU', label: 'Europe', hint: REGIONS.EU.label },
      { value: 'NA', label: 'North America', hint: REGIONS.NA.label },
      { value: 'FE', label: 'Far East', hint: REGIONS.FE.label },
    ],
    initialValue: state.region ?? 'EU',
  });

  if (p.isCancel(region)) {
    p.cancel('Setup cancelled. Re-run "npm run setup" to start again.');
    process.exit(0);
  }

  return {
    ...state,
    region: region as 'EU' | 'NA' | 'FE',
    lastCompletedStage: 'region',
  };
}
