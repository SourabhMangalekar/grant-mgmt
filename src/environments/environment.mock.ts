/**
 * Offline demo build: every IAM and grant-service call is answered in the browser by core/auth/mock-iam.interceptor.ts.
 * Run it with `ng serve --configuration mock`; plain `ng serve` always talks to the real backends.
 */
export const environment = {
  /** Never contacted in mock mode: the interceptor answers anything under this prefix. */
  grantServiceUrl: 'https://grant-service.mock/commons-grant-service',
  debugMode: 1,
  mockApi: true,
};
