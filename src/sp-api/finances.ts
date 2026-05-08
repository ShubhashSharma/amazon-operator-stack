/**
 * SP-API Finances endpoint — listFinancialEvents.
 *
 * Returns the line-item ledger entries that make up a seller's payouts:
 * shipments (orders + their fees), refunds, adjustments, service fees, etc.
 *
 * Three things to remember from prior client builds:
 *   1. Event type names returned by the API strip the "EventList" suffix
 *      (the docs show "ShipmentEventList" but the runtime returns "ShipmentEvent").
 *   2. Amazon returns fees as NEGATIVE numbers — flip signs at the parser stage.
 *   3. Refunds reduce gross sales, not net fees. Direction-guard any P&L logic.
 *
 * Read-only. Idempotent. Paginates automatically.
 */

import { z } from 'zod';
import { loadConfig } from '../lib/config.js';
import { rateLimit } from '../lib/rate-limiter.js';
import { withRetry, ensureOk, AmazonApiError } from '../lib/retry.js';
import { spApiHeaders, clearSpApiCache } from '../auth/lwa.js';
import { spApiBaseUrl } from '../lib/endpoints.js';

export const ListFinancialEventsInput = z.object({
  postedAfter: z
    .string()
    .describe('ISO 8601 date. Earliest event posted date to include.'),
  postedBefore: z
    .string()
    .optional()
    .describe('ISO 8601 date. Latest event posted date. Defaults to now.'),
  maxResultsPerPage: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(100)
    .describe('Page size. Max 100.'),
});

export const ListFinancialEventsOutput = z.object({
  shipmentEvents:    z.array(z.record(z.string(), z.unknown())),
  refundEvents:      z.array(z.record(z.string(), z.unknown())),
  adjustmentEvents:  z.array(z.record(z.string(), z.unknown())),
  serviceFeeEvents:  z.array(z.record(z.string(), z.unknown())),
  otherEvents:       z.array(z.record(z.string(), z.unknown())),
  pageCount: z.number().int(),
  warnings:  z.array(z.string()),
});

export async function listFinancialEvents(
  input: z.infer<typeof ListFinancialEventsInput>,
): Promise<z.infer<typeof ListFinancialEventsOutput>> {
  const cfg = loadConfig().spApi;
  const warnings: string[] = [
    'Fees come back as NEGATIVE numbers — if you sum them naively your totals will go the wrong way.',
  ];

  const collected = {
    ShipmentEventList:   [] as Record<string, unknown>[],
    RefundEventList:     [] as Record<string, unknown>[],
    AdjustmentEventList: [] as Record<string, unknown>[],
    ServiceFeeEventList: [] as Record<string, unknown>[],
    Other:               [] as Record<string, unknown>[],
  };

  let nextToken: string | undefined;
  let pageCount = 0;

  do {
    pageCount++;
    await rateLimit('finances/listFinancialEvents');

    const url = buildUrl(spApiBaseUrl(cfg.endpoint), input, nextToken);

    const data = await withRetry(async () => {
      let headers = await spApiHeaders();
      try {
        const res = await fetch(url, { headers });
        return (await ensureOk(res)) as { payload: Record<string, unknown> };
      } catch (err) {
        if (err instanceof AmazonApiError && err.classified.class === 'auth_expired') {
          clearSpApiCache();
          headers = await spApiHeaders();
          const res = await fetch(url, { headers });
          return (await ensureOk(res)) as { payload: Record<string, unknown> };
        }
        throw err;
      }
    });

    const payload = data.payload as Record<string, unknown>;
    const events = (payload.FinancialEvents ?? {}) as Record<string, unknown>;

    pushIfArray(events.ShipmentEventList,   collected.ShipmentEventList);
    pushIfArray(events.RefundEventList,     collected.RefundEventList);
    pushIfArray(events.AdjustmentEventList, collected.AdjustmentEventList);
    pushIfArray(events.ServiceFeeEventList, collected.ServiceFeeEventList);

    // Capture any "other" event lists we don't model explicitly so callers
    // can spot uncategorised flows
    for (const [key, val] of Object.entries(events)) {
      if (!['ShipmentEventList', 'RefundEventList', 'AdjustmentEventList', 'ServiceFeeEventList'].includes(key)) {
        if (Array.isArray(val)) {
          for (const v of val) {
            collected.Other.push({ __type: key.replace(/EventList$/, 'Event'), ...(v as object) });
          }
        }
      }
    }

    nextToken = (payload.NextToken as string | undefined) ?? undefined;
  } while (nextToken);

  return {
    shipmentEvents:   collected.ShipmentEventList,
    refundEvents:     collected.RefundEventList,
    adjustmentEvents: collected.AdjustmentEventList,
    serviceFeeEvents: collected.ServiceFeeEventList,
    otherEvents:      collected.Other,
    pageCount,
    warnings,
  };
}

function pushIfArray(src: unknown, dest: Record<string, unknown>[]): void {
  if (Array.isArray(src)) dest.push(...(src as Record<string, unknown>[]));
}

function buildUrl(
  endpoint: string,
  input: z.infer<typeof ListFinancialEventsInput>,
  nextToken: string | undefined,
): string {
  const params = new URLSearchParams();
  params.set('PostedAfter', new Date(input.postedAfter).toISOString());
  if (input.postedBefore) {
    params.set('PostedBefore', new Date(input.postedBefore).toISOString());
  }
  params.set('MaxResultsPerPage', String(input.maxResultsPerPage));
  if (nextToken) params.set('NextToken', nextToken);
  return `${endpoint}/finances/v0/financialEvents?${params.toString()}`;
}

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerFinancesTool(server: McpServer): void {
  server.registerTool(
    'sp_list_financial_events',
    {
      title:       'List Amazon Financial Events',
      description:
        'Pull the financial event ledger from SP-API for a date range. Returns shipment, ' +
        'refund, adjustment, service fee, and other events separately. Fees are NEGATIVE — ' +
        'flip signs at parse time. Use this for true gross/net reconciliation, not just orders.',
      inputSchema:  ListFinancialEventsInput,
      outputSchema: ListFinancialEventsOutput,
      annotations: {
        readOnlyHint:    true,
        idempotentHint:  true,
      },
    },
    async (input) => {
      const result = await listFinancialEvents(input);
      const summary =
        `Pulled ${result.shipmentEvents.length} shipments, ` +
        `${result.refundEvents.length} refunds, ` +
        `${result.adjustmentEvents.length} adjustments, ` +
        `${result.serviceFeeEvents.length} service fees, ` +
        `${result.otherEvents.length} other across ${result.pageCount} page(s).`;
      const warningText = result.warnings.length ? '\n\n⚠ ' + result.warnings.join('\n⚠ ') : '';
      return {
        content: [{ type: 'text' as const, text: summary + warningText }],
        structuredContent: result,
      };
    },
  );
}
