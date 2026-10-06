/** Backend URLs for production builds. Point grantServiceUrl at the deployed commons-grant-service. */
export const environment = {
  grantServiceUrl: 'https://level-rewrite-magnetize.ngrok-free.dev/commons-grant-service',
  /** Never prefill forms in production. */
  debugMode: 0,
};
