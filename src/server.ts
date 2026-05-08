#!/usr/bin/env node
/**
 * amazon-operator-stack — MCP server for Amazon SP-API.
 *
 * Read-only by default. Exposes Orders, Finances, and Sales & Traffic to Claude
 * Code with rate limiting, retries, and 400-vs-403 error classification baked in.
 *
 * Built for Seller Sessions Live 2026. Ads API + write tools live in
 * HOMEWORK.md — once a delegate has gone through the wizard at home.
 *
 * Reference pattern: src/sp-api/orders.ts. Every other tool follows that shape.
 */

import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

import { loadConfig, log } from './lib/config.js';

import { registerOrdersTool } from './sp-api/orders.js';
import { registerFinancesTool } from './sp-api/finances.js';
import { registerSalesAndTrafficTool } from './sp-api/sales-and-traffic.js';

async function main(): Promise<void> {
  // Validate config before transport handshake — fail fast if misconfigured
  loadConfig();

  const server = new McpServer(
    {
      name:    'amazon-operator-stack',
      version: '1.0.0',
    },
    {
      capabilities: { logging: {} },
      instructions: [
        'This server exposes read-only Amazon SP-API tools. Important rules:',
        '',
        '• Sales & Traffic is rate-limited to 1 request per 45 seconds. Long-window pulls take time.',
        '• Sales & Traffic data is delayed 24-48h. Never ask for "today" — ask for "yesterday".',
        '• Orders endpoint includes "Pending" status by default; Seller Central excludes them. Totals will not match unless you filter.',
        '• Finances API returns fees as NEGATIVE numbers — flip signs at parse time.',
        '• A 400 response means the SP-API role IS granted but parameters are wrong — fix params, do not request the role again.',
        '• A 403 response means the role is NOT granted — go to Seller Central → Apps & Services → Develop Apps to grant it.',
      ].join('\n'),
    },
  );

  // Read-only SP-API tools
  registerOrdersTool(server);
  registerFinancesTool(server);
  registerSalesAndTrafficTool(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // MCP servers must NOT print to stdout — that's the transport.
  log('info', 'amazon-operator-stack listening on stdio (read-only mode)');
}

main().catch((err) => {
  console.error('Fatal: amazon-operator-stack failed to start');
  console.error(err);
  process.exit(1);
});
