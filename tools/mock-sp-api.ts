#!/usr/bin/env node
/**
 * Mock SP-API + LWA server.
 *
 * Lets us stress-test the wizard, probe matrix, and MCP server end-to-end
 * without ever touching a real Seller Central account.
 *
 * Usage:
 *   npm run mock                    # listens on http://localhost:9999
 *   PORT=8080 npm run mock          # custom port
 *   MOCK_VERBOSE=1 npm run mock     # log every request
 *
 * Then point the wizard / probe / server at it:
 *   MOCK_BASE_URL=http://localhost:9999 npm run setup
 *   MOCK_BASE_URL=http://localhost:9999 npm run smoke-test
 *
 * Error injection (per-request, via header or query):
 *   X-Mock-Inject: 403_role_denied        → SP-API role denied
 *   X-Mock-Inject: 403_brand_registry     → Brand Registry gating
 *   X-Mock-Inject: 401                    → access token expired
 *   X-Mock-Inject: 429                    → rate limited
 *   X-Mock-Inject: 500                    → server error
 *   ?_inject=...                          → same, via query string
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';

const PORT = parseInt(process.env.PORT ?? '9999', 10);
const VERBOSE = !!process.env.MOCK_VERBOSE;

interface MockRoute {
  method: string;
  pattern: RegExp;
  handler: (req: IncomingMessage, body: string, params: URLSearchParams) => MockResponse;
}

interface MockResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

const routes: MockRoute[] = [
  // ─── LWA token exchange ─────────────────────────────────────────────
  {
    method: 'POST',
    pattern: /^\/auth\/o2\/token$/,
    handler: (_req, body) => {
      const params = new URLSearchParams(body);
      const grantType = params.get('grant_type');
      const refreshToken = params.get('refresh_token');
      const clientId = params.get('client_id');

      if (grantType !== 'refresh_token') {
        return { status: 400, body: { error: 'unsupported_grant_type', error_description: 'grant_type must be refresh_token' } };
      }
      if (!refreshToken || !clientId) {
        return { status: 400, body: { error: 'invalid_request', error_description: 'missing refresh_token or client_id' } };
      }
      // Test path: refresh token "Atzr|MOCK_INVALID" returns 401
      if (refreshToken.includes('MOCK_INVALID')) {
        return { status: 400, body: { error: 'invalid_grant', error_description: 'refresh token revoked' } };
      }

      return {
        status: 200,
        body: {
          access_token: `Atza|MOCK_${Date.now()}`,
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: refreshToken,
        },
      };
    },
  },

  // ─── SP-API: marketplace participations ─────────────────────────────
  {
    method: 'GET',
    pattern: /^\/sellers\/v1\/marketplaceParticipations$/,
    handler: () => ({
      status: 200,
      body: {
        payload: [
          {
            marketplace: { id: 'A1F83G8C2ARO7P', name: 'Amazon.co.uk', countryCode: 'GB', defaultCurrencyCode: 'GBP', defaultLanguageCode: 'en_GB', domainName: 'www.amazon.co.uk' },
            participation: { isParticipating: true, hasSuspendedListings: false },
          },
          {
            marketplace: { id: 'A1PA6795UKMFR9', name: 'Amazon.de', countryCode: 'DE', defaultCurrencyCode: 'EUR', defaultLanguageCode: 'de_DE', domainName: 'www.amazon.de' },
            participation: { isParticipating: true, hasSuspendedListings: false },
          },
        ],
      },
    }),
  },

  // ─── SP-API: orders ─────────────────────────────────────────────────
  {
    method: 'GET',
    pattern: /^\/orders\/v0\/orders$/,
    handler: (_req, _body, params) => {
      const max = parseInt(params.get('MaxResultsPerPage') ?? '100', 10);
      const orders = mockOrders(Math.min(max, 5));
      return {
        status: 200,
        body: {
          payload: {
            Orders: orders,
            CreatedBefore: new Date().toISOString(),
            LastUpdatedBefore: new Date().toISOString(),
          },
        },
      };
    },
  },

  // ─── SP-API: FBA inventory summaries ────────────────────────────────
  {
    method: 'GET',
    pattern: /^\/fba\/inventory\/v1\/summaries$/,
    handler: () => ({
      status: 200,
      body: {
        payload: {
          granularity: { granularityType: 'Marketplace', granularityId: 'A1F83G8C2ARO7P' },
          inventorySummaries: [
            { asin: 'B0EXAMPLE01', sellerSku: 'SKU-001-MOCK', condition: 'NewItem', totalQuantity: 142 },
            { asin: 'B0EXAMPLE02', sellerSku: 'SKU-002-MOCK', condition: 'NewItem', totalQuantity: 38 },
          ],
        },
        pagination: {},
      },
    }),
  },

  // ─── SP-API: financial events ───────────────────────────────────────
  {
    method: 'GET',
    pattern: /^\/finances\/v0\/financialEvents$/,
    handler: () => ({
      status: 200,
      body: {
        payload: {
          FinancialEvents: {
            ShipmentEventList: [
              {
                AmazonOrderId: '202-MOCK-0000001',
                PostedDate: new Date(Date.now() - 86400000).toISOString(),
                ShipmentItemList: [
                  {
                    SellerSKU: 'SKU-001-MOCK',
                    OrderItemId: 'ORDERITEM-MOCK-001',
                    QuantityShipped: 1,
                    ItemChargeList: [{ ChargeType: 'Principal', ChargeAmount: { CurrencyCode: 'GBP', CurrencyAmount: 24.99 } }],
                    ItemFeeList:    [{ FeeType: 'Commission',  FeeAmount:    { CurrencyCode: 'GBP', CurrencyAmount: -3.75 } }],
                  },
                ],
              },
            ],
            RefundEventList: [],
            AdjustmentEventList: [],
            ServiceFeeEventList: [],
          },
        },
      },
    }),
  },

  // ─── SP-API: reports list ───────────────────────────────────────────
  {
    method: 'GET',
    pattern: /^\/reports\/2021-06-30\/reports$/,
    handler: () => ({
      status: 200,
      body: { reports: [], nextToken: null },
    }),
  },

  // ─── SP-API: create report (Sales & Traffic) ────────────────────────
  {
    method: 'POST',
    pattern: /^\/reports\/2021-06-30\/reports$/,
    handler: () => ({
      status: 202,
      body: { reportId: 'REPORT-MOCK-' + Date.now() },
    }),
  },

  // ─── SP-API: get report status ──────────────────────────────────────
  {
    method: 'GET',
    pattern: /^\/reports\/2021-06-30\/reports\/[^/]+$/,
    handler: (req) => ({
      status: 200,
      body: {
        reportId: req.url?.split('/').pop(),
        reportType: 'GET_SALES_AND_TRAFFIC_REPORT',
        processingStatus: 'DONE',
        reportDocumentId: 'DOC-MOCK-' + Date.now(),
      },
    }),
  },

  // ─── SP-API: get report document ────────────────────────────────────
  {
    method: 'GET',
    pattern: /^\/reports\/2021-06-30\/documents\/[^/]+$/,
    handler: () => ({
      status: 200,
      body: {
        reportDocumentId: 'DOC-MOCK',
        url: `http://localhost:${PORT}/__mock_doc__`,
      },
    }),
  },

  // ─── Mock document download ─────────────────────────────────────────
  {
    method: 'GET',
    pattern: /^\/__mock_doc__$/,
    handler: () => ({
      status: 200,
      body: {
        salesAndTrafficByAsin: [
          { date: yesterday(), parentAsin: 'B0EXAMPLE01', childAsin: 'B0EXAMPLE01', sales: { orderedProductSales: { amount: 412.36, currencyCode: 'GBP' } }, traffic: { sessions: 184, pageViews: 219, browserSessions: 152 } },
          { date: yesterday(), parentAsin: 'B0EXAMPLE02', childAsin: 'B0EXAMPLE02', sales: { orderedProductSales: { amount: 89.94, currencyCode: 'GBP' } }, traffic: { sessions: 47, pageViews: 61, browserSessions: 39 } },
        ],
      },
    }),
  },
];

// ─────────────────────────────────────────────────────────────────────
// Server
// ─────────────────────────────────────────────────────────────────────

function handle(req: IncomingMessage, res: ServerResponse, body: string): void {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const params = url.searchParams;

  // Error injection — header > query > global env (so tests can pin all responses)
  const inject =
    (req.headers['x-mock-inject'] as string | undefined) ??
    params.get('_inject') ??
    process.env.MOCK_INJECT ??
    '';
  if (inject) {
    // Don't inject on the LWA token endpoint unless explicitly wanted via header/query.
    // Pinning a global error to LWA would block every request before the probe even runs.
    const isLwa = url.pathname === '/auth/o2/token';
    const isGlobal = inject === process.env.MOCK_INJECT;
    if (!(isLwa && isGlobal)) {
      const injected = injectError(inject);
      if (injected) return send(res, injected);
    }
  }

  for (const route of routes) {
    if (route.method !== req.method) continue;
    if (!route.pattern.test(url.pathname)) continue;
    try {
      const response = route.handler(req, body, params);
      return send(res, response);
    } catch (err) {
      return send(res, { status: 500, body: { error: 'mock_handler_failed', message: (err as Error).message } });
    }
  }

  send(res, {
    status: 404,
    body: { errors: [{ code: 'NotFound', message: `mock has no route for ${req.method} ${url.pathname}` }] },
  });
}

function injectError(inject: string): MockResponse | null {
  switch (inject) {
    case '403_role_denied':
      return { status: 403, body: { errors: [{ code: 'Unauthorized', message: 'Access denied. Application does not have access to the requested resource. The role is not granted.' }] } };
    case '403_brand_registry':
      return { status: 403, body: { errors: [{ code: 'Unauthorized', message: 'This endpoint requires Brand Registry membership for the seller.' }] } };
    case '401':
      return { status: 401, body: { errors: [{ code: 'InvalidToken', message: 'Access token expired.' }] } };
    case '429':
      return { status: 429, headers: { 'Retry-After': '2' }, body: { errors: [{ code: 'QuotaExceeded', message: 'Request throttled.' }] } };
    case '500':
      return { status: 500, body: { errors: [{ code: 'InternalFailure', message: 'Mock-injected server error.' }] } };
    default:
      return null;
  }
}

function send(res: ServerResponse, r: MockResponse): void {
  res.statusCode = r.status;
  res.setHeader('Content-Type', 'application/json');
  if (r.headers) for (const [k, v] of Object.entries(r.headers)) res.setHeader(k, v);
  res.end(JSON.stringify(r.body));
}

function mockOrders(n: number): unknown[] {
  return Array.from({ length: n }, (_, i) => ({
    AmazonOrderId: `202-MOCK-${String(1000000 + i).padStart(7, '0')}`,
    PurchaseDate: new Date(Date.now() - (i + 1) * 3600_000).toISOString(),
    LastUpdateDate: new Date().toISOString(),
    OrderStatus: i % 4 === 0 ? 'Pending' : 'Shipped',
    FulfillmentChannel: 'AFN',
    SalesChannel: 'Amazon.co.uk',
    OrderTotal: { CurrencyCode: 'GBP', Amount: (Math.random() * 80 + 10).toFixed(2) },
    NumberOfItemsShipped: i % 4 === 0 ? 0 : 1,
    NumberOfItemsUnshipped: i % 4 === 0 ? 1 : 0,
    MarketplaceId: 'A1F83G8C2ARO7P',
  }));
}

function yesterday(): string {
  const d = new Date(Date.now() - 86400000);
  return d.toISOString().slice(0, 10);
}

const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', c => chunks.push(c as Buffer));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    if (VERBOSE) {
      const inject = req.headers['x-mock-inject'] || '';
      console.log(`[mock] ${req.method} ${req.url}${inject ? ' [inject=' + inject + ']' : ''}`);
    }
    handle(req, res, body);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock-sp-api listening on http://localhost:${PORT}`);
  console.log(`run the wizard with:  MOCK_BASE_URL=http://localhost:${PORT} npm run setup`);
  console.log(`run the probe with:   MOCK_BASE_URL=http://localhost:${PORT} npm run smoke-test`);
});
