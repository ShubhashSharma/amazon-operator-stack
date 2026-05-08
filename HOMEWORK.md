# Homework

Some things can't be done in a 75-minute workshop slot. They need waiting periods, or more thought about what data you want exposed, or design decisions that depend on your business.

This is your homework. Pick up each section when it's relevant to you. None of these are required for the basic read-only setup to work — they're upgrades.

---

## What's in here

| # | Section                                | Time     | Blocked by    |
|---|----------------------------------------|----------|---------------|
| 1 | [Add the Ads API](#1-add-the-ads-api)  | ~30 min + 1–3 days waiting | Amazon manual review |
| 2 | [Add restricted (PII) roles](#2-add-restricted-pii-roles) | ~15 min + Amazon review | Amazon manual review |
| 3 | [Enable more marketplaces](#3-enable-more-marketplaces)  | ~5 min   | None          |
| 4 | [Layer write capabilities](#4-layer-write-capabilities) | A weekend | None          |

Pick the ones that matter to you. Skip the others.

---

## 1. Add the Ads API

The Ads API gives you access to Sponsored Products, Sponsored Brands, and Sponsored Display campaign data. You can pull spend, sales, ACOS, and ROAS at the keyword and campaign level.

The reason it's homework: **Amazon reviews every Ads API application by hand.** Approval takes 1 to 3 business days, sometimes longer. You can't do this in the workshop slot.

### What you'll do

1. Apply for Ads API access.
2. Wait for Amazon to approve you.
3. Create a Login With Amazon (LWA) **Security Profile** — separate from your SP-API LWA app.
4. Run the OAuth flow to get an Ads API refresh token.
5. Drop the credentials into your `.env`.
6. Re-run `npm run smoke-test`.

### Step-by-step

#### A. Apply for Ads API access

1. Open [advertising.amazon.com/API/docs/en-us/setting-up/account-setup](https://advertising.amazon.com/API/docs/en-us/setting-up/account-setup).
2. Click **Apply for API access**.
3. Fill in the form. Use:
   - Use case: *internal reporting and analytics for our own ad accounts*
   - Data scope: *campaign performance, no PII*
4. Submit.

You'll get an email when Amazon decides. Most replies come back within 48 hours.

#### B. Create a Login With Amazon Security Profile

While you wait for approval, set up the LWA Security Profile. This is **different** from your SP-API LWA app.

1. Open [developer.amazon.com](https://developer.amazon.com), sign in with the same Amazon account.
2. **Apps & Services → Login with Amazon → Create a new Security Profile**.
3. Name it `Operator Command Centre — Ads`. Description, privacy URL, logo all optional for own-use.
4. Save.

Once Amazon approves your Ads API application, your Security Profile is automatically whitelisted for the Ads API. Until then, OAuth login will succeed but Ads API calls will fail with a clear "not whitelisted" error.

#### C. Run the OAuth flow

This step uses a localhost callback (port 3000 by default). The wizard already pre-flighted port 3000 for you.

We've not yet shipped a wizard for this — it's a stretch feature. For now, run the manual flow:

```bash
npm run setup:ads  # not built yet — coming in v1.1
```

If you're impatient, the manual flow is documented in Amazon's official guide at [advertising.amazon.com/API/docs/en-us/setting-up/generate-api-tokens](https://advertising.amazon.com/API/docs/en-us/setting-up/generate-api-tokens).

#### D. Drop credentials into `.env`

Open your `.env` and replace the `not-configured` placeholders with the values from the OAuth flow:

```
ADS_API_CLIENT_ID=amzn1.application-oa2-client.xxxx
ADS_API_CLIENT_SECRET=amzn1.oa2-cs.v1.xxxx
ADS_API_REFRESH_TOKEN=Atzr|xxxx
```

#### E. Probe

```bash
npm run smoke-test
```

If the Ads endpoints come back green, you're done. The MCP server picks up the new credentials on next restart.

---

## 2. Add restricted (PII) roles

Restricted roles give you access to **buyer-identifying data** — names, addresses, phone numbers, tax IDs, gift messages.

The reason it's homework: **Amazon manually reviews every restricted role request.** They want to see your data handling, retention, and security policies. Approval takes a week or two and may require you to submit screenshots of how you store the data.

### Should you do this?

Most operators don't need it. Read-only analytics, reporting, dashboards, AI assistants — none of those need PII. Skip this section unless you have a clear business reason (e.g. tax invoice generation, fraud investigation, customer support tooling).

### Step-by-step

1. Seller Central → Apps & Services → Develop Apps → your app → **Edit app**.
2. Tick the **Restricted role(s)** you need:
   - *Direct-to-Consumer Shipping* — ship-to addresses
   - *Buyer Communication* — buyer email, gift messages
   - *Tax Invoicing* — buyer tax IDs (EU)
3. Save.

Amazon then sends you a **Data Protection Questionnaire**. Fill it in carefully. Common gotchas:

- They want to know **where** PII is stored (region, provider).
- They want to know **how long** you retain it.
- They want to know **who** has access.

Submit. Wait. When approved, **re-authorise the app** — your existing refresh token doesn't carry restricted roles until you click Authorize again.

Then re-run:

```bash
npm run smoke-test
```

---

## 3. Enable more marketplaces

If you only ticked your primary marketplace during the wizard but you also sell in other countries, you can enable them in two ways.

### Option A — Re-run the wizard's marketplace step

```bash
npm run setup
```

When prompted, pick "Resume from where I left off" or "Start over" (your call), and re-do the marketplace step ticking the additional countries.

### Option B — Edit `.env` directly

Faster if you know the marketplace IDs. Open `.env` and edit:

```
SP_API_ENABLED_MARKETPLACE_IDS=A1F83G8C2ARO7P,A1PA6795UKMFR9,A13V1IB3VIYZZH
```

Comma-separated, no spaces. Reference IDs:

| Country  | Marketplace ID    |
|----------|-------------------|
| UK       | A1F83G8C2ARO7P    |
| Germany  | A1PA6795UKMFR9    |
| France   | A13V1IB3VIYZZH    |
| Italy    | APJ6JRA9NG5V4     |
| Spain    | A1RKKUPIHCS9HS    |
| US       | ATVPDKIKX0DER     |
| Canada   | A2EUQ1WTGCTBG2    |
| Mexico   | A1AM78C64UM0Y8    |
| Japan    | A1VC38T7YXB528    |
| Australia| A39IBJ37TRP1C6    |
| India    | A21TJRUUN4KGV     |

If you switch your **primary** marketplace too, also update `SP_API_MARKETPLACE_ID` to the new primary and `SP_API_MARKETPLACE_CODE` to its two-letter code.

Restart Claude Code to pick up the changes.

---

## 4. Layer write capabilities

Right now, the server is **read-only**. It can't change anything in your store.

Adding write means the server can:

- Create / pause / archive ad campaigns
- Adjust bids and budgets
- Submit listing updates
- Create refunds via the Orders API
- Submit Inventory Feeds

This is a powerful upgrade. It's also the upgrade most likely to cause real damage if a tool misbehaves — a bug or a confused AI can hit your live ad budget or a real customer order.

### What we recommend

1. **Wait at least two weeks** before adding write. Use the read-only setup to build trust in how Claude reasons about your data first.
2. **Add write one tool at a time.** Don't ship the full SP-API surface. Pick one (e.g. campaign budget adjustments) and live with it for a week before adding another.
3. **Always require confirmation prompts** for irreversible actions. The MCP `requireConfirmation` annotation handles this for you.
4. **Always log every write call** to a file alongside `.env`. Most write bugs are diagnosed from logs, not error messages.

### How to wire a new write tool

The pattern lives in [`src/sp-api/orders.ts`](./src/sp-api/orders.ts). For a write equivalent:

```ts
export const PostInventoryAdjustmentInput = z.object({
  sku: z.string(),
  delta: z.number().int(),
});

export const PostInventoryAdjustmentOutput = z.object({
  success: z.boolean(),
  newQuantity: z.number().int(),
});

export async function postInventoryAdjustment(
  input: z.infer<typeof PostInventoryAdjustmentInput>,
): Promise<z.infer<typeof PostInventoryAdjustmentOutput>> {
  // 1. rate-limit
  // 2. spApiHeaders
  // 3. POST request with idempotency key
  // 4. handle 401 → refresh + retry once
  // 5. write a log line to ~/.amazon-operator-stack/writes.log
  // 6. return structured + warning content
}
```

Three rules to bake in for every write tool:

1. **Idempotency key** in the request (`X-Amzn-Requestid` header) — Amazon dedupes repeated requests with the same key.
2. **`destructiveHint: true`** in the MCP tool annotations.
3. **`readOnlyHint: false`** in the MCP tool annotations — Claude treats this as the gate for "this changes things, ask the user first".

When you've added a write tool, re-run:

```bash
npm run build
npm run wire-claude   # re-register so Claude picks up the new tool
```

Restart Claude Code. The new tool appears alongside the read-only ones.

---

## Stuck?

The probe matrix is still your best friend:

```bash
npm run smoke-test
```

If you've added something and the probe doesn't reflect it, you've probably skipped one of: re-authorising the app after granting a new role; restarting Claude Code; running `npm run build` after editing source.
