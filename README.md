# amazon-operator-stack

Connect your Amazon seller account to Claude Code.

After a 30-minute setup, you can ask Claude things like:

- *"Pull last week's orders for ASIN B0XXXXXXX."*
- *"Reconcile yesterday's shipment events against my Seller Central payouts."*
- *"How many sessions did our hero ASIN get in March, and what was the conversion rate?"*

Claude calls the right Amazon endpoint, with rate limits and retries handled for you.

This is **read-only**. It can look at your data. It cannot change anything in your store. Adding write capabilities is covered in [HOMEWORK.md](./HOMEWORK.md).

---

## Who this is for

Built for **Seller Sessions Live 2026** delegates.

You should be:

- An Amazon seller with a **Pro Seller** account (not Individual)
- The **account holder** (not a staff user)
- Comfortable copying and pasting into a terminal

You don't need to know what an MCP server, OAuth token, or LWA app is. The wizard explains each one in plain language as you go.

---

## What you get

| Asset                                     | Where                                            |
| ----------------------------------------- | ------------------------------------------------ |
| MCP server connecting Claude → SP-API      | This folder, after `npm install` and `npm run build` |
| Read access to Orders, Finances, Sales & Traffic | Three tools registered with Claude Code          |
| Local credentials file (`.env`)           | This folder, git-ignored, never sent anywhere    |
| Claude Code MCP entry                     | `~/.claude/settings.json` (additive — your existing entries are untouched) |
| Probe matrix (`npm run smoke-test`)        | Runs any time, tells you which roles are working |

---

## Quick start

If you have **Node 20+** and **Claude Code** installed:

```bash
git clone https://github.com/ShubhashSharma/amazon-operator-stack.git
cd amazon-operator-stack
npm install
npm run setup
npm run build
npm run wire-claude
```

That's it. Restart Claude Code, then try one of the [sample questions](#try-it) below.

If you're missing prerequisites, follow the full guide in [SETUP.md](./SETUP.md) instead.

### Prefer a guided web wizard?

Open **[amazon-operator-stack-setup.vercel.app](https://amazon-operator-stack-setup.vercel.app)** in any browser. It walks you through the same 7 steps as a multi-step form, your progress is saved automatically as you go, and the final step gives you a single copy-paste command that clones this repo, drops the `.env` in place, and wires it into Claude Code.

Privacy-by-design — no backend, your refresh token never leaves your browser. Optional JSON backup of in-progress answers if you want belt-and-braces on the autosave.

The take-home companion to the Seller Sessions Live 2026 stage demo.

---

## Try it

Once Claude Code has restarted, paste any of these into the chat:

| Goal                              | What to ask Claude                                                            |
| --------------------------------- | ----------------------------------------------------------------------------- |
| Yesterday's revenue               | *"Pull my Amazon orders from the last 24 hours and total the revenue."*        |
| Top 5 SKUs by revenue this week   | *"Pull the last 7 days of orders, group by SKU, sort by revenue."*             |
| Reconcile against Seller Central  | *"List financial events from yesterday, sum the shipment events, and tell me what to expect in my next payout."* |
| Find unusual fees                  | *"Pull the last 14 days of financial events. Flag any service fees that look unusual relative to the average."* |
| Sales & Traffic deep dive         | *"Get last week's Sales & Traffic report. Which ASIN had the highest sessions but the worst conversion rate?"*   |
| Stockout risk                      | *"Pull my FBA inventory summary. Highlight any SKU with under 30 days of cover at current sales velocity."*       |

Three things Claude does well with these tools:

1. **Multi-step reasoning** — chains tool calls together (orders → financial events → reconciliation) without you having to script it.
2. **Surface gotchas** — the tools return warnings inline (e.g. "Pending orders included" or "fees come back as negative"), and Claude reads those before drawing conclusions.
3. **Caveat its own answers** — if Sales & Traffic is gated by Brand Registry, Claude says so rather than silently returning incomplete data.

---

## What the setup wizard does

Run `npm run setup` and the wizard walks you through seven steps:

1. **Pre-flight checks** — confirms Node, port 3000, internet to Amazon
2. **Pick your region** — Europe, North America, or Far East
3. **Pick your marketplaces** — primary one + any others you sell on
4. **Register as an Amazon developer** — one-time, free, instant for read-only roles
5. **Authorise the app** — click one button in Seller Central, paste a token
6. **Test that everything works** — probe matrix tells you which endpoints are live
7. **Save credentials** — to a local `.env` file, git-ignored

If you get interrupted at any point, run `npm run resume`. The wizard picks up exactly where you left off.

---

## Architecture in one minute

```
┌──────────────────────┐                  ┌──────────────────────┐
│   Claude Code (you)  │  ── stdio ────▶  │ amazon-operator-stack│
│ in VS Code or CLI    │                  │  (this MCP server)   │
└──────────────────────┘                  └──────────┬───────────┘
                                                      │
                                                 HTTPS │ LWA token
                                                      ▼
                                          ┌──────────────────────┐
                                          │  Amazon SP-API       │
                                          │  (your seller data)  │
                                          └──────────────────────┘
```

- The server runs locally, on your machine.
- It only ever reads data — no writes.
- Your refresh token never leaves the `.env` file on this machine.

---

## What happens next

| Step                       | File              |
| -------------------------- | ----------------- |
| First-time setup            | [SETUP.md](./SETUP.md) |
| Add Ads API, PII, more marketplaces, or write capabilities | [HOMEWORK.md](./HOMEWORK.md) |
| Re-test your roles after granting more | `npm run smoke-test` |
| If something breaks         | [SETUP.md → Troubleshooting](./SETUP.md#troubleshooting) |

---

## Built by

[**not a square**](https://notasquare.io) — operations and AI consulting for Amazon brands doing £500K to £30M.

For Seller Sessions Live 2026, hosted by [Danny McMillan](https://sellersessions.com).

[MIT licensed](./LICENSE).
