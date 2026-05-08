/**
 * Endpoint resolution.
 *
 * If MOCK_BASE_URL is set in the environment, both the LWA token URL and the
 * SP-API base URL get rerouted there. This lets us stress-test the wizard,
 * probe, and MCP server end-to-end against tools/mock-sp-api.ts without
 * touching a real Seller Central account.
 *
 * In production (no MOCK_BASE_URL set) the calls go to Amazon's real endpoints.
 */

export function lwaTokenUrl(): string {
  const mock = process.env.MOCK_BASE_URL;
  return mock
    ? `${mock.replace(/\/$/, '')}/auth/o2/token`
    : 'https://api.amazon.com/auth/o2/token';
}

export function spApiBaseUrl(configuredEndpoint: string): string {
  const mock = process.env.MOCK_BASE_URL;
  return mock ? mock.replace(/\/$/, '') : configuredEndpoint;
}

export function isMockMode(): boolean {
  return !!process.env.MOCK_BASE_URL;
}
