import { environment } from '../../environments/environment';

/** App-wide runtime config for the GRANT-MGMT app on Platform Commons (dev). */
export const APP_CONFIG = {
  /** Proxied to https://dev.platformcommons.org/gateway/commons-iam-service (see proxy.conf.json). */
  iamBaseUrl: '/iam',
  /** commons-grant-service, called directly from the browser. Set per build in src/environments/. */
  grantBaseUrl: environment.grantServiceUrl,
  /** Prefill forms with sample data (environment.debugMode === 1). */
  debugMode: environment.debugMode === 1,
  /** Serve IAM endpoints from an in-browser mock (see core/auth/mock-iam.interceptor.ts) instead of the gateway. */
  mockApi: false,
  /** Header that carries the session id. Some IAM endpoints return it as `SESSIONID` instead. */
  sessionHeader: 'X-SESSIONID',

  /** App registered in app-config (id 48) and IAM app-keys (id 46). Sent as appContext everywhere. */
  appCode: 'GRANT-MGMT',
  /** IAM app key. Also used to try for an anonymous pre-login session (needs the key registered against a tenant). */
  appKey: 'b573faa1-f188-4551-bde0-3c77bd1fbf42',
  /** Tenant the app key is registered against, for GET /api-keys/session. Null skips the pre-login session. */
  appKeyTenantLogin: null as string | null,

  /** Tenant.tenantType values that tell granters and grantees apart. */
  tenantTypes: { granter: 'TENANT_TYPE.GRANTER', grantee: 'TENANT_TYPE.GRANTEE' },

  /** LeadDTO.type for a new organisation (confirmed in the IAM self-registration how-to). */
  orgLeadType: 'ORGANIZATION',
  /** LeadDTO.type for a user joining an existing organisation. Assumed — IAM rejects unknown values with a 500. */
  userLeadType: 'INDIVIDUAL',

  /** marketContext for IAM user-verification (joiners await org-admin approval). Assumed value. */
  verificationMarketContext: 'GRANT-MGMT',
  /** UserVerification.verificationStatus values that mean "approved". Assumed values. */
  approvedStatuses: ['APPROVED', 'VERIFIED', 'USER_VERIFICATION_STATUS.APPROVED', 'USER_VERIFICATION_STATUS.VERIFIED'],
};

export type Affiliation = keyof typeof APP_CONFIG.tenantTypes;
