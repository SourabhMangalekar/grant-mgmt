/**
 * Backend URLs for local development. Production builds use environment.prod.ts instead (angular.json fileReplacements).
 * Change grantServiceUrl here when the grant service moves off the ngrok tunnel.
 */
export const environment = {
  grantServiceUrl: 'https://c520-49-200-149-202.ngrok-free.app/commons-grant-service',
  /** 1 = prefill forms with sample data for quick manual testing. Keep 0 in environment.prod.ts. */
  debugMode: 1,
  /** Real backends. For the offline demo, run `ng serve --configuration mock` (environment.mock.ts) instead of changing this. */
  mockApi: false,
};
