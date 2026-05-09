/**
 * Step 4 — Register as an Amazon developer + create the SP-API app.
 *
 * This is the longest step. We split it into clear sub-steps and pause for
 * confirmation at each so the delegate is never lost.
 *
 * The Developer Console asks for an app name. We default to "Operator Command
 * Centre" so when they look in their developer dashboard later, the app's
 * provenance is obvious.
 *
 * For SP-API self-authorised apps, no redirect URI / OAuth dance is needed.
 * The delegate clicks "Authorize" inside their own developer console and gets
 * a refresh token directly. Step 5 captures that token.
 */

import * as p from '@clack/prompts';
import { stageHeader, explainStage, dim, teal } from '../theme.js';
import type { SetupState } from '../state.js';

const DEFAULT_APP_NAME = 'Operator Command Centre';

const DEV_CONSOLE_URL = 'https://sellercentral.amazon.com/sellingpartner/developerconsole';

export async function developerAppStage(state: SetupState): Promise<SetupState> {
  stageHeader(4, 7, 'Create your SP-API app in Seller Central');

  if (state.spApi?.clientId && state.spApi?.clientSecret) {
    p.log.success(`${teal('✓ prefilled:')} ${state.spApi.appName} ${dim('(LWA Client ID + secret loaded)')}`);
    return { ...state, lastCompletedStage: 'developer-app' };
  }

  explainStage(
    'Amazon needs you to register as a developer (one-time, free, instant for read-only roles) and create an app for your own seller account. The app is private — only you use it.',
    'We open the Developer Console for you, you fill in a short form, then you paste two values back here: the LWA Client ID and Client Secret.',
  );

  // Sub-step A: Register as a developer (if not already)
  p.note(
    [
      `1. Open  ${teal(DEV_CONSOLE_URL)}`,
      '',
      `2. If you see ${teal('"Register as a Developer"')}, click it.`,
      '   Pick:  "I or the company I represent are developing applications for our own use."',
      '   This is the path that gets approved instantly. The other path takes weeks.',
      '',
      `3. Accept the SP-API Developer Agreement.`,
      '',
      dim('If you have registered before, skip to the app creation step below.'),
    ].join('\n'),
    'A — Register as a developer',
  );

  const ackDev = await p.confirm({
    message: 'Done with developer registration?',
    initialValue: true,
  });
  if (p.isCancel(ackDev) || !ackDev) {
    p.cancel('No problem. Re-run "npm run resume" when you have finished.');
    process.exit(0);
  }

  // Sub-step B: Create the SP-API app
  const appName = await p.text({
    message: 'What should we call your app inside Amazon?',
    placeholder: DEFAULT_APP_NAME,
    defaultValue: DEFAULT_APP_NAME,
    initialValue: state.spApi?.appName ?? DEFAULT_APP_NAME,
  });
  if (p.isCancel(appName)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  p.note(
    [
      `1. Still in  ${teal(DEV_CONSOLE_URL)}`,
      '',
      `2. Click  ${teal('"Add new app client"')}`,
      '',
      `3. Fill in the form:`,
      `   App name:           ${teal(appName as string)}`,
      `   API type:           SP-API`,
      `   App\'s description:  Internal read-only operations console`,
      `   IAM ARN / OAuth login URI / OAuth redirect URI:  Leave blank.`,
      '',
      `4. Pick the data access roles you want.  ${teal('Recommended for today:')}`,
      `   - Inventory and Order Tracking`,
      `   - Pricing`,
      `   - Product Listing`,
      `   - Selling Partner Insights  ${dim('(needed for Sales & Traffic)')}`,
      `   - Finance and Accounting`,
      '',
      `5. Submit. The app appears in your dashboard with status ${teal('"Draft"')}.`,
      '',
      dim('Restricted roles (PII, buyer info) require manual Amazon review and are covered in HOMEWORK.md. Not needed for today.'),
    ].join('\n'),
    'B — Create the SP-API app',
  );

  const ackApp = await p.confirm({
    message: 'App created and showing in your dashboard?',
    initialValue: true,
  });
  if (p.isCancel(ackApp) || !ackApp) {
    p.cancel('No rush. "npm run resume" picks up exactly where you stopped.');
    process.exit(0);
  }

  // Sub-step C: Capture credentials
  p.note(
    [
      `1. On your app row, click  ${teal('"View"')}  next to "LWA credentials".`,
      '',
      `2. Copy the  ${teal('Client identifier')}  and  ${teal('Client secret')}  values.`,
      '',
      `3. Paste them below. Both are long strings starting with "amzn1.".`,
      '',
      dim('We never send these anywhere. They are written to a local .env file alongside this folder.'),
    ].join('\n'),
    'C — Copy the LWA credentials',
  );

  const clientId = await p.text({
    message: 'Paste your LWA Client identifier:',
    placeholder: 'amzn1.application-oa2-client.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    validate: v => {
      if (!v || v.length < 20) return 'That looks too short. The Client identifier is a long string starting with amzn1.';
      if (!v.startsWith('amzn1.')) return 'That does not look right. It should start with "amzn1.".';
      return undefined;
    },
  });
  if (p.isCancel(clientId)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  const clientSecret = await p.password({
    message: 'Paste your LWA Client secret:',
    validate: v => {
      if (!v || v.length < 20) return 'That looks too short. The Client secret is a long string.';
      return undefined;
    },
  });
  if (p.isCancel(clientSecret)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  return {
    ...state,
    spApi: {
      appName: appName as string,
      clientId: clientId as string,
      clientSecret: clientSecret as string,
      refreshToken: state.spApi?.refreshToken ?? '',
    },
    lastCompletedStage: 'developer-app',
  };
}
