/**
 * Step 3 — Marketplace selection.
 *
 * Two pieces of information:
 *   1. Primary marketplace — the one we test against in the probe matrix and
 *      report results in. One per delegate. Defaults to the obvious pick for
 *      the region.
 *   2. Enabled marketplaces — every marketplace whose data we'll let through
 *      the MCP server. Defaults to all marketplaces in the region. The
 *      delegate can trim this if they only sell in one country.
 */

import * as p from '@clack/prompts';
import { stageHeader, explainStage } from '../theme.js';
import { marketplacesByRegion } from '../marketplaces.js';
import type { SetupState } from '../state.js';

export async function marketplaceStage(state: SetupState): Promise<SetupState> {
  stageHeader(3, 7, 'Pick your marketplaces');

  if (!state.region) {
    throw new Error('Region must be set before picking marketplaces. Run setup from the start.');
  }

  const available = marketplacesByRegion(state.region);

  explainStage(
    'Amazon treats each country as a separate marketplace. Your account may only sell in one or it may sell across many.',
    'You pick your primary marketplace. We default the rest to all countries in your region — trim them if you only sell in one or two.',
  );

  // Sensible default per region
  const defaultPrimary = pickRegionDefault(state.region);

  const primary = await p.select({
    message: 'Which marketplace is your primary one? (used for the probe and live demo)',
    options: available.map(m => ({
      value: m.id,
      label: m.label,
      hint: m.code,
    })),
    initialValue: state.primaryMarketplaceId ?? defaultPrimary,
  });

  if (p.isCancel(primary)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  const enabled = await p.multiselect({
    message: 'Which marketplaces should the MCP server have access to?',
    options: available.map(m => ({
      value: m.id,
      label: m.label,
      hint: m.code,
    })),
    initialValues: state.enabledMarketplaceIds ?? available.map(m => m.id),
    required: true,
  });

  if (p.isCancel(enabled)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  // Always include the primary, even if they unticked it by accident
  const enabledIds = Array.from(new Set([primary as string, ...(enabled as string[])]));
  const primaryMp = available.find(m => m.id === primary)!;

  return {
    ...state,
    primaryMarketplaceId: primaryMp.id,
    primaryMarketplaceCode: primaryMp.code,
    primaryMarketplaceLabel: primaryMp.label,
    enabledMarketplaceIds: enabledIds,
    lastCompletedStage: 'marketplace',
  };
}

function pickRegionDefault(region: 'EU' | 'NA' | 'FE'): string {
  switch (region) {
    case 'EU': return 'A1F83G8C2ARO7P'; // GB
    case 'NA': return 'ATVPDKIKX0DER';   // US
    case 'FE': return 'A1VC38T7YXB528';  // JP
  }
}
