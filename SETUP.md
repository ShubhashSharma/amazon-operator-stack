# Setup guide

Read this end-to-end if it's your first time. The wizard mirrors these steps and prompts you at each one — this guide is the reference if something looks unfamiliar inside the wizard, or if you want to know what's happening before you start.

**Total time:** about 30 minutes from a cold start.

**You will need:**

- A Pro Seller Amazon account (not Individual)
- Account holder access (not a staff sub-user)
- A laptop with Node.js 20 or newer
- Claude Code installed (VS Code extension or CLI)
- 30 minutes of uninterrupted time

---

## Table of contents

1. [Before you start](#1-before-you-start)
2. [Install the repo](#2-install-the-repo)
3. [Run the wizard](#3-run-the-wizard)
4. [Wire it into Claude Code](#4-wire-it-into-claude-code)
5. [Try it out](#5-try-it-out)
6. [Troubleshooting](#troubleshooting)
7. [Glossary (plain English)](#glossary-plain-english)

---

## 1. Before you start

A handful of things make the rest of this guide go smoothly.

### Check Node.js

Open your terminal and run:

```bash
node -v
```

If you see `v20.0.0` or higher, you're set. If you see anything lower, or `command not found`, install Node from [nodejs.org](https://nodejs.org/) (the **LTS** version is the right one).

### Check Claude Code

In your terminal:

```bash
claude --version
```

If it prints a version number, you're set. If not, install it from [claude.com/claude-code](https://claude.com/claude-code).

### Sign in to Seller Central

Open [sellercentral.amazon.com](https://sellercentral.amazon.com) (or your country's domain) in your browser and sign in. The wizard sends you back to Seller Central a couple of times — being already logged in saves time.

### A note on iCloud

If your machine syncs everything through iCloud, **clone this repo somewhere outside iCloud**. iCloud occasionally creates duplicate folders that break Node builds. A folder like `~/code/` or `~/projects/` is safe.

---

## 2. Install the repo

In your terminal:

```bash
cd ~/code                 # or wherever you keep your projects
git clone https://github.com/sellersessions/amazon-operator-stack.git
cd amazon-operator-stack
npm install
```

`npm install` downloads the libraries the server uses (about 30 seconds on a normal connection).

---

## 3. Run the wizard

```bash
npm run setup
```

The wizard takes you through seven steps. Each step shows you a short note explaining **why we're asking** and **what happens next** — so nothing feels arbitrary.

### Step 1 — Pre-flight checks

The wizard checks Node version, supported OS, port 3000 availability, and whether your machine can reach Amazon. If anything is amber, you can still continue — the wizard warns but doesn't block.

### Step 2 — Pick your region

Amazon runs three regional clouds. Pick the one your Seller Central account lives in:

| Region | Marketplaces                                                  |
| ------ | ------------------------------------------------------------- |
| Europe | UK, Germany, France, Italy, Spain, Netherlands, Sweden, Poland, Belgium, Turkey |
| North America | US, Canada, Mexico, Brazil                              |
| Far East | Japan, Australia, Singapore, India                          |

If your account is North America (US sellers), pick **North America**. If it's UK or any EU country, pick **Europe**. Most sellers know this from the URL they sign in to (`sellercentral.amazon.co.uk` = EU, `sellercentral.amazon.com` = NA, etc.).

### Step 3 — Pick your marketplaces

You pick:

- **One primary marketplace** — the one we test against in step 6. Defaults to the obvious pick for your region (UK for Europe, US for North America, Japan for Far East).
- **All enabled marketplaces** — every country whose data you want the MCP server to be able to read. Defaults to all marketplaces in your region. Untick any countries you don't sell in.

For today, the primary is what matters. The other marketplaces are saved in your `.env` and the server will pick them up later when you ask Claude about a specific country.

### Step 4 — Register as an Amazon developer

This is a one-time step. Even if you've sold on Amazon for years, "developer" registration is a separate switch you flip the first time someone or something you trust needs to talk to your account programmatically.

The wizard pauses and tells you:

> *Open https://sellercentral.amazon.com/sellingpartner/developerconsole. If you see "Register as a Developer", click it. Pick "I or the company I represent are developing applications for our own use." Accept the agreement.*

Picking the **"for our own use"** path is important. It means you're approved instantly. The other path (publishing apps to other sellers) takes weeks of Amazon review and is not what you need.

After developer registration, the wizard prompts you to **create the SP-API app**. This is the actual application that talks to your account.

You name the app. The wizard suggests **Operator Command Centre** as a default — it's a clean, generic name that you'll recognise when you look at your developer console six months from now. Change it if you want.

You'll fill in a simple form on Amazon's side:

- **App name** — what you typed above
- **API type** — SP-API
- **Description** — `Internal read-only operations console` (or whatever)
- **IAM ARN, OAuth login URI, OAuth redirect URI** — leave **all three blank**

Then pick the **roles**. These are the data permissions your app gets. For today's read-only setup, tick:

| Role                       | What it gives you                          |
| -------------------------- | ------------------------------------------ |
| Inventory and Order Tracking | Orders, FBA inventory                    |
| Pricing                    | Buy Box pricing                            |
| Product Listing            | Listing data                               |
| Selling Partner Insights    | Sales & Traffic (needs Brand Registry too) |
| Finance and Accounting      | Financial events ledger                    |

Submit. The app appears in your dashboard, status **Draft**.

The wizard then asks you to copy two values from the app's "View" pop-out:

- **LWA Client identifier** (a long string starting with `amzn1.application-oa2-client.`)
- **LWA Client secret** (a long string starting with `amzn1.oa2-cs.`)

Paste both into the wizard. They're saved to your local `.env` and never sent anywhere else.

### Step 5 — Authorise the app

Back in the developer console, click **Authorize** next to your app.

Amazon shows a single screen with a long token starting with `Atzr|`. That's your **refresh token**. It's the credential that lets the server talk to your account on your behalf.

Copy it in full and paste it into the wizard.

> **Treat the refresh token like a password.** Anyone with this string can read your seller data. The wizard saves it to a `.env` file that is git-ignored by default.

### Step 6 — Test everything

The wizard runs a **probe matrix** — a small set of canary calls that check whether each role you ticked is actually working:

| Endpoint                   | Means                                              |
| -------------------------- | -------------------------------------------------- |
| Orders                     | Order data is reachable                            |
| FBA Inventory              | Inventory data is reachable                        |
| Finances                   | Payouts ledger is reachable                        |
| Reports                    | Report generation is reachable                     |
| Marketplace participations | Your seller account itself is reachable            |

You'll see one of three status icons per row:

- **Green tick** — works. Data is flowing.
- **Amber `!`** — works in principle, but the data is gated. Most common reason: Brand Registry. Skip this for today if you're not brand registered.
- **Red `✗`** — role not granted. Go back to Seller Central → Develop Apps → Edit, tick the role, save, then re-run `npm run smoke-test`.

### Step 7 — Save credentials

The wizard writes your `.env` file. If a `.env` already existed (e.g. from an earlier run), it's backed up to `.env.bak.<timestamp>` first.

The wizard exits with a summary:

```
Done. Your Amazon seller account is connected.

Primary marketplace:  United Kingdom (amazon.co.uk)
Credentials saved at: /Users/you/code/amazon-operator-stack/.env
Tools available:      4

Next:  npm run wire-claude    Register the server with Claude Code
       npm run smoke-test     Re-run the probe matrix any time
       open HOMEWORK.md       Pick up Ads API + write capabilities
```

---

## 4. Wire it into Claude Code

Two more commands and you're done:

```bash
npm run build
npm run wire-claude
```

`npm run build` compiles the TypeScript into JavaScript that Claude Code can run. `npm run wire-claude` adds an entry to your `~/.claude/settings.json` so Claude Code knows about the new server.

Restart Claude Code (or run `claude` again from your terminal). The new tools appear automatically.

---

## 5. Try it out

In Claude Code, ask any of these:

> *Pull the last 7 days of Amazon orders. Group them by SKU and show me top 5 by revenue.*

> *List financial events from the last 14 days. Tell me which adjustments looked unusual.*

> *Get Sales & Traffic for last week. Which ASIN had the highest conversion rate?*

If Claude isn't picking up the new tools, see [Troubleshooting](#troubleshooting).

---

## Troubleshooting

### "Refresh token starts with Atzr but is too short"

You probably copied a partial token. The full string is several hundred characters long. Open Seller Central → Develop Apps, click Authorize again, copy the full token in one go (use the Copy button if you can see one).

### Probe shows everything as "role denied"

Two common causes:

1. You ticked the roles in the form but didn't click **Save** at the bottom. Go back, save, and re-run `npm run smoke-test`.
2. You authorised the app **before** ticking the roles. The refresh token only carries the roles that existed at authorisation time. Re-authorise: in the developer console click Authorize again, copy the new token, run `npm run resume` and paste the new token at the refresh-token step.

### Probe shows Sales & Traffic as "gated"

This is normal if you're not in Brand Registry. Sales & Traffic data is reserved for brand registered sellers. Either skip it (the other tools still work) or apply for Brand Registry and come back. [HOMEWORK.md](./HOMEWORK.md) has the steps.

### Claude Code doesn't see the new tools

Three checks, in order:

1. Did you run `npm run build`? Without this, there's no compiled server for Claude to launch.
2. Did you restart Claude Code? Settings are read on startup, not live.
3. Run `cat ~/.claude/settings.json | grep amazon-operator-stack`. If nothing prints, re-run `npm run wire-claude`.

### Anything else

Re-run the probe: `npm run smoke-test`. The output tells you exactly which endpoint is unhappy and what the next step is.

---

## Glossary (plain English)

**SP-API** — The Selling Partner API. Amazon's official way to read and write your seller data. We use it read-only.

**LWA** — "Login With Amazon". The authentication protocol. Think of it as the bouncer that checks the app's ID before letting it through.

**Client ID and Client Secret** — Two strings Amazon gives you when you create an app. The Client ID identifies which app is calling. The Client Secret proves it's really that app and not someone pretending. The pair acts like a username and password.

**Refresh token** — A long-lived credential you copy once after clicking "Authorize". The server uses it to mint short-lived access tokens whenever it needs to talk to Amazon. Refresh tokens never expire unless you revoke them.

**Access token** — A short-lived token (60 minutes) the server gets by trading the refresh token. It's what actually goes on the API request to Amazon.

**Marketplace ID** — A long opaque string Amazon uses internally to identify a country marketplace. UK is `A1F83G8C2ARO7P`. You don't need to remember any of these — the wizard handles them.

**Probe matrix** — A small grid of test calls, one per endpoint, that confirms whether your roles are working. Run any time with `npm run smoke-test`.

**Role** — A permission slot in your developer console. You tick which data the app can see. Each tool uses one or two roles.

**MCP server** — Model Context Protocol server. The standard way Claude Code talks to external tools. This repo IS an MCP server. You don't need to understand the protocol — just run `npm run wire-claude` and Claude picks it up.

**Brand Registry** — Amazon's programme for trademark holders. Some data (Sales & Traffic, Brand Analytics) is reserved for Brand Registry members. If you're not in it, those endpoints return 403 — the probe matrix flags them as "gated" and you can ignore them.
