import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Backend-for-frontend proxy for Orkes Conductor.
 *
 * Same contract as server.js: the Conductor app key/secret live here,
 * server-side, and the browser only ever calls the three /api/* routes.
 */
export const conductorProxy = defineFunction({
  name: 'conductor-proxy',
  entry: './handler.ts',
  timeoutSeconds: 30,
  environment: {
    // Set with: npx ampx sandbox secret set <NAME>
    CONDUCTOR_SERVER_URL: secret('CONDUCTOR_SERVER_URL'),
    CONDUCTOR_AUTH_KEY: secret('CONDUCTOR_AUTH_KEY'),
    CONDUCTOR_AUTH_SECRET: secret('CONDUCTOR_AUTH_SECRET'),
    // Non-sensitive config — safe to keep in source.
    WORKFLOW_NAME: 'policy_underwriting',
    WORKFLOW_VERSION: '1',
    REVIEW_TASK_REF: 'underwriter_review_ref',
  },
});
