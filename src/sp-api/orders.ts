/**
 * SP-API Orders endpoint.
 *
 * Reference implementation pattern — every other SP-API tool follows this shape:
 *   1. Validate inputs with Zod
 *   2. Acquire a rate-limit token for the endpoint
 *   3. Build URL + headers with auth
 *   4. Wrap the call in withRetry + ensureOk for retries + error classification
 *   5. Refresh auth and retry once on 401
 *   6. Return structured content + a readable text summary
 *
 * Two important warnings baked into the responses:
 *   - SP-API Orders endpoint includes 'Pending' status; Seller Central's order
 *     screen excludes them. Total counts will not match unless you filter.
 *   - getOrderItems is per-order — calling it for >300 orders/day will exhaust
 *     rate limits within minutes. Use the Orders Report instead at scale.
 */

import { z } from 'zod';
import { loadConfig } from '../lib/config.js';
import { rateLimit } from '../lib/rate-limiter.js';
import { withRetry, ensureOk, AmazonApiError } from '../lib/retry.js';
import { spApiHeaders, clearSpApiCache } from '../auth/lwa.js';
import { spApiBaseUrl } from '../lib/endpoints.js';

// ─────────────────────────────────────────────────────────────────────
// Zod schemas — public API surface
// ─────────────────────────────────────────────────────────────────────

export const GetOrdersInput = z.object({
  createdAfter: z
    .string()
    .describe('ISO 8601 date (e.g. "2026-04-01" or "2026-04-01T00:00:00Z"). Earliest order creation date to include.'),
  createdBefore: z
    .string()
    .optional()
    .describe('ISO 8601 date. Latest order creation date. Defaults to now.'),
  orderStatuses: z
    .array(z.enum([
      'Pending', 'Unshipped', 'PartiallyShipped',
      'Shipped', 'Canceled', 'Unfulfillable', 'InvoiceUnconfirmed',
    ]))
    .optional()
    .describe('Filter by order status. Omit to include all (which means Pending too).'),
  fulfillmentChannels: z
    .array(z.enum(['AFN', 'MFN']))
    .optional()
    .describe('AFN = FBA, MFN = FBM. Omit to include both.'),
  maxResultsPerPage: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(100)
    .describe('Page size. Max 100.'),
});

export const GetOrdersOutput = z.object({
  orders:    z.array(z.record(z.string(), z.unknown())),
  pageCount: z.number().int(),
  totalOrders: z.number().int(),
  warnings:  z.array(z.string()),
});

// ─────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────

export async function getOrders(
  input: z.infer<typeof GetOrdersInput>,
): Promise<z.infer<typeof GetOrdersOutput>> {
  const cfg = loadConfig().spApi;
  const warnings: string[] = [];

  // Warn about Pending — most users compare to Seller Central which excludes them
  if (!input.orderStatuses) {
    warnings.push(
      'Order results include "Pending" status orders. Seller Central excludes Pending — ' +
      'totals will not match unless you filter to Unshipped/Shipped/etc.',
    );
  }

  const allOrders: Record<string, unknown>[] = [];
  let nextToken: string | undefined;
  let pageCount = 0;

  do {
    pageCount++;
    await rateLimit('orders/getOrders');

    const url = buildUrl(spApiBaseUrl(cfg.endpoint), cfg.marketplaceId, input, nextToken);

    const data = await withRetry(async () => {
      let headers = await spApiHeaders();
      try {
        const res = await fetch(url, { headers });
        return (await ensureOk(res)) as { payload: { Orders?: Record<string, unknown>[]; NextToken?: string } };
      } catch (err) {
        // 401 — clear cache and retry once with fresh token
        if (err instanceof AmazonApiError && err.classified.class === 'auth_expired') {
          clearSpApiCache();
          headers = await spApiHeaders();
          const res = await fetch(url, { headers });
          return (await ensureOk(res)) as { payload: { Orders?: Record<string, unknown>[]; NextToken?: string } };
        }
        throw err;
      }
    });

    const orders = data.payload.Orders ?? [];
    allOrders.push(...orders);
    nextToken = data.payload.NextToken;
  } while (nextToken);

  return {
    orders:      allOrders,
    pageCount,
    totalOrders: allOrders.length,
    warnings,
  };
}

function buildUrl(
  endpoint: string,
  marketplaceId: string,
  input: z.infer<typeof GetOrdersInput>,
  nextToken: string | undefined,
): string {
  const params = new URLSearchParams();
  params.set('MarketplaceIds', marketplaceId);
  params.set('CreatedAfter', new Date(input.createdAfter).toISOString());
  if (input.createdBefore) {
    params.set('CreatedBefore', new Date(input.createdBefore).toISOString());
  }
  if (input.orderStatuses?.length) {
    params.set('OrderStatuses', input.orderStatuses.join(','));
  }
  if (input.fulfillmentChannels?.length) {
    params.set('FulfillmentChannels', input.fulfillmentChannels.join(','));
  }
  params.set('MaxResultsPerPage', String(input.maxResultsPerPage));
  if (nextToken) params.set('NextToken', nextToken);

  return `${endpoint}/orders/v0/orders?${params.toString()}`;
}

// ─────────────────────────────────────────────────────────────────────
// Tool registration helper — used by index.ts to add this to the server
// ─────────────────────────────────────────────────────────────────────

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerOrdersTool(server: McpServer): void {
  server.registerTool(
    'sp_get_orders',
    {
      title:       'Get Amazon Orders',
      description:
        'Pull orders from Amazon SP-API for a date range. Returns full order objects ' +
        'plus warnings about gotchas (Pending status, Seller Central reconciliation). ' +
        'Paginates automatically. Use sp_get_order_items for line-item detail per order.',
      inputSchema:  GetOrdersInput,
      outputSchema: GetOrdersOutput,
      annotations: {
        readOnlyHint:    true,
        idempotentHint:  true,
      },
    },
    async (input) => {
      const result = await getOrders(input);
      const warningText = result.warnings.length
        ? '\n\n⚠ ' + result.warnings.join('\n⚠ ')
        : '';
      return {
        content: [
          {
            type: 'text' as const,
            text:
              `Pulled ${result.totalOrders} orders across ${result.pageCount} page(s).` +
              warningText,
          },
        ],
        structuredContent: result,
      };
    },
  );
}
