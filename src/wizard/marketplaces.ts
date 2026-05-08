/**
 * Marketplace + region reference data.
 *
 * Source of truth for the wizard. Maps human-readable country names to the
 * marketplace IDs Amazon's APIs require, and groups them by region so we can
 * pick the right SP-API and Ads API endpoint.
 */

export interface Marketplace {
  /** Two-letter country code, e.g. "GB". */
  code: string;
  /** Human label shown in the picker. */
  label: string;
  /** Amazon marketplace ID (the long opaque string the API needs). */
  id: string;
  /** Region key — drives endpoint selection. */
  region: 'EU' | 'NA' | 'FE';
}

export interface RegionConfig {
  key: 'EU' | 'NA' | 'FE';
  label: string;
  spApiEndpoint: string;
  spApiAwsRegion: string;
  adsApiEndpoint: string;
}

export const REGIONS: Record<'EU' | 'NA' | 'FE', RegionConfig> = {
  EU: {
    key: 'EU',
    label: 'Europe (UK, Germany, France, Italy, Spain, Netherlands, Sweden, Poland, Belgium, Turkey)',
    spApiEndpoint: 'https://sellingpartnerapi-eu.amazon.com',
    spApiAwsRegion: 'eu-west-1',
    adsApiEndpoint: 'https://advertising-api-eu.amazon.com',
  },
  NA: {
    key: 'NA',
    label: 'North America (US, Canada, Mexico, Brazil)',
    spApiEndpoint: 'https://sellingpartnerapi-na.amazon.com',
    spApiAwsRegion: 'us-east-1',
    adsApiEndpoint: 'https://advertising-api.amazon.com',
  },
  FE: {
    key: 'FE',
    label: 'Far East (Japan, Australia, Singapore, India)',
    spApiEndpoint: 'https://sellingpartnerapi-fe.amazon.com',
    spApiAwsRegion: 'us-west-2',
    adsApiEndpoint: 'https://advertising-api-fe.amazon.com',
  },
};

export const MARKETPLACES: Marketplace[] = [
  // EU
  { code: 'GB', label: 'United Kingdom (amazon.co.uk)', id: 'A1F83G8C2ARO7P', region: 'EU' },
  { code: 'DE', label: 'Germany (amazon.de)',           id: 'A1PA6795UKMFR9', region: 'EU' },
  { code: 'FR', label: 'France (amazon.fr)',            id: 'A13V1IB3VIYZZH', region: 'EU' },
  { code: 'IT', label: 'Italy (amazon.it)',             id: 'APJ6JRA9NG5V4',  region: 'EU' },
  { code: 'ES', label: 'Spain (amazon.es)',             id: 'A1RKKUPIHCS9HS', region: 'EU' },
  { code: 'NL', label: 'Netherlands (amazon.nl)',       id: 'A1805IZSGTT6HS', region: 'EU' },
  { code: 'SE', label: 'Sweden (amazon.se)',            id: 'A2NODRKZP88ZB9', region: 'EU' },
  { code: 'PL', label: 'Poland (amazon.pl)',            id: 'A1C3SOZRARQ6R3', region: 'EU' },
  { code: 'BE', label: 'Belgium (amazon.com.be)',       id: 'AMEN7PMS3EDWL',  region: 'EU' },
  { code: 'TR', label: 'Turkey (amazon.com.tr)',        id: 'A33AVAJ2PDY3EV', region: 'EU' },

  // NA
  { code: 'US', label: 'United States (amazon.com)',    id: 'ATVPDKIKX0DER',  region: 'NA' },
  { code: 'CA', label: 'Canada (amazon.ca)',            id: 'A2EUQ1WTGCTBG2',  region: 'NA' },
  { code: 'MX', label: 'Mexico (amazon.com.mx)',        id: 'A1AM78C64UM0Y8',  region: 'NA' },
  { code: 'BR', label: 'Brazil (amazon.com.br)',        id: 'A2Q3Y263D00KWC',  region: 'NA' },

  // FE
  { code: 'JP', label: 'Japan (amazon.co.jp)',          id: 'A1VC38T7YXB528',  region: 'FE' },
  { code: 'AU', label: 'Australia (amazon.com.au)',     id: 'A39IBJ37TRP1C6',  region: 'FE' },
  { code: 'SG', label: 'Singapore (amazon.sg)',         id: 'A19VAU5U5O7RUS',  region: 'FE' },
  { code: 'IN', label: 'India (amazon.in)',             id: 'A21TJRUUN4KGV',   region: 'FE' },
];

export function marketplacesByRegion(region: 'EU' | 'NA' | 'FE'): Marketplace[] {
  return MARKETPLACES.filter(m => m.region === region);
}

export function findMarketplace(id: string): Marketplace | undefined {
  return MARKETPLACES.find(m => m.id === id);
}
