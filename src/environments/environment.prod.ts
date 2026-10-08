/** Backend URLs for production builds. Point grantServiceUrl at the deployed commons-grant-service. */
export const environment = {
  grantServiceUrl: 'https://c520-49-200-149-202.ngrok-free.app/commons-grant-service',
  /** Never prefill forms in production. */
  debugMode: 0,
  mockApi: false,
};
