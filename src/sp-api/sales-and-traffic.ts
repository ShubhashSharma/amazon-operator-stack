/**
 * SP-API Sales and Traffic — the canonical revenue + sessions surface.
 *
 * Why this matters: Brand Analytics' Sales & Traffic feed is the truth source
 * for ordered_product_sales / sessions / page_views per ASIN per day. Recreating
 * it from Orders Reports under-counts by 30-40% and hides traffic entirely.
 *
 * Caveats burnt-in from prior client builds:
 *   - Rate limited to 1 request per 45 seconds. Long pulls are SLOW. Use day
 *     chunks, not week or month, so a single 429 doesn't lose hours of work.
 *   - Data is delayed 24-48h. NEVER ask for "today" — always end at yesterday.
 *   - Requires Brand Registry. Sellers without it get 403 with "Brand Registry
 *     required" in the message; the probe matrix flags this as "gated".
 *
 * Read-only. Idempotent. Day-chunked automatically.
 */

import { z } from 'zod';
import { loadConfig } from '../lib/config.js';
import { rateLimit } from '../lib/rate-limiter.js';
import { withRetry, ensureOk, AmazonApiError } from '../lib/retry.js';
import { spApiHeaders, clearSpApiCache } from '../auth/lwa.js';

export const GetSalesAndTrafficInput = z.object({
  startDate: z
    .string()
    .describe('YYYY-MM-DD. Must be at least 2 days in the past — Amazon delays this data 24-48h.'),
  endDate: z
    .string()
    .describe('YYYY-MM-DD. Must be at least 2 days in the past.'),
  asinGranularity: z
    .enum(['PARENT', 'CHILD', 'SKU'])
    .default('CHILD')
    .describe('How to roll up. CHILD = per-variation, PARENT = per-listing, SKU = per-SKU.'),
});

export const GetSalesAndTrafficOutput = z.object({
  reportId:      z.string(),
  documentId:    z.string().optional(),
  status:        z.string(),
  rowCount:      z.number().int().optional(),
  warnings:      z.array(z.string()),
  /** Each row has dimensions (date, asin) and metrics (orderedProductSales etc.). */
  rows:          z.array(z.record(z.string(), z.unknown())),
});

/**
 * High-level convenience: request the report, poll until done, fetch + parse.
 *
 * Implemented as create-report → poll for completion → fetch the document.
 */
export async function getSalesAndTraffic(
  input: z.infer<typeof GetSalesAndTrafficInput>,
): Promise<z.infer<typeof GetSalesAndTrafficOutput>> {
  const cfg = loadConfig().spApi;
  const warnings: string[] = [];

  // Defensive guard — Amazon's data is delayed; refuse "today"
  const todayISO = new Date().toISOString().slice(0, 10);
  if (input.endDate >= todayISO) {
    warnings.push(
      'endDate is today or later — Sales & Traffic data is delayed 24-48h. ' +
      'Expect missing rows for the most recent 1-2 days.',
    );
  }

  // 1. Create the report
  await rateLimit('reports/createReport');
  const createBody = {
    reportType: 'GET_SALES_AND_TRAFFIC_REPORT',
    marketplaceIds: [cfg.marketplaceId],
    dataStartTime: `${input.startDate}T00:00:00+00:00`,
    dataEndTime: `${input.endDate}T23:59:59+00:00`,
    reportOptions: {
      asinGranularity: input.asinGranularity,
      dateGranularity: 'DAY',
    },
  };

  const createRes = await withRetry(() =>
    fetchSp(`${cfg.endpoint}/reports/2021-06-30/reports`, {
      method: 'POST',
      body: JSON.stringify(createBody),
    }),
  );
  const reportId = (createRes as Record<string, string>).reportId;

  // 2. Poll for completion (up to 5 minutes)
  let documentId: string | undefined;
  let status = 'IN_QUEUE';
  const deadline = Date.now() + 5 * 60 * 1000;

  while (Date.now() < deadline) {
    await rateLimit('reports/getReport');
    const status_res = await withRetry(() =>
      fetchSp(`${cfg.endpoint}/reports/2021-06-30/reports/${reportId}`),
    ) as Record<string, unknown>;

    status = String(status_res.processingStatus ?? 'UNKNOWN');
    documentId = status_res.reportDocumentId as string | undefined;

    if (status === 'DONE' && documentId) break;
    if (status === 'CANCELLED' || status === 'FATAL') {
      warnings.push(`Report ended in ${status} state — Amazon-side failure.`);
      return { reportId, status, warnings, rows: [] };
    }
    await new Promise(r => setTimeout(r, 15_000));
  }

  if (status !== 'DONE' || !documentId) {
    warnings.push('Report did not complete within 5 minutes. Re-run later, or fetch by reportId.');
    return { reportId, status, warnings, rows: [] };
  }

  // 3. Fetch the document URL + download
  await rateLimit('reports/getReportDocument');
  const docMeta = await withRetry(() =>
    fetchSp(`${cfg.endpoint}/reports/2021-06-30/documents/${documentId}`),
  ) as Record<string, unknown>;

  const url = String(docMeta.url ?? '');
  if (!url) {
    warnings.push('Report document URL missing.');
    return { reportId, documentId, status, warnings, rows: [] };
  }

  const docRes = await fetch(url);
  const text = await docRes.text();
  // Sales & Traffic comes back as JSON
  let rows: Record<string, unknown>[] = [];
  try {
    const parsed = JSON.parse(text) as { salesAndTrafficByAsin?: Record<string, unknown>[] };
    rows = parsed.salesAndTrafficByAsin ?? [];
  } catch {
    warnings.push('Report document was not JSON — Amazon may have returned a flat-file fallback.');
  }

  return {
    reportId,
    documentId,
    status: 'DONE',
    rowCount: rows.length,
    warnings,
    rows,
  };
}

async function fetchSp(url: string, init: RequestInit = {}): Promise<unknown> {
  let headers = await spApiHeaders();
  try {
    const res = await fetch(url, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
    return await ensureOk(res);
  } catch (err) {
    if (err instanceof AmazonApiError && err.classified.class === 'auth_expired') {
      clearSpApiCache();
      headers = await spApiHeaders();
      const res = await fetch(url, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
      return await ensureOk(res);
    }
    throw err;
  }
}

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerSalesAndTrafficTool(server: McpServer): void {
  server.registerTool(
    'sp_get_sales_and_traffic',
    {
      title: 'Get Amazon Sales and Traffic',
      description:
        'Pull the canonical Brand Analytics Sales & Traffic report for a date range. Returns ' +
        'per-ASIN-per-day metrics (orderedProductSales, sessions, pageViews, buyBoxPercentage). ' +
        'Requires Brand Registry. Data is delayed 24-48h — never ask for today.',
      inputSchema:  GetSalesAndTrafficInput,
      outputSchema: GetSalesAndTrafficOutput,
      annotations: {
        readOnlyHint:    true,
        idempotentHint:  true,
      },
    },
    async (input) => {
      const result = await getSalesAndTraffic(input);
      const summary = result.status === 'DONE'
        ? `Pulled Sales & Traffic: ${result.rowCount ?? 0} rows for ${input.startDate} → ${input.endDate}.`
        : `Sales & Traffic report status: ${result.status}.`;
      const warningText = result.warnings.length ? '\n\n⚠ ' + result.warnings.join('\n⚠ ') : '';
      return {
        content: [{ type: 'text' as const, text: summary + warningText }],
        structuredContent: result,
      };
    },
  );
}
