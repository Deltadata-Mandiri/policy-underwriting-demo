import { defineBackend } from '@aws-amplify/backend';
import { FunctionUrlAuthType, HttpMethod } from 'aws-cdk-lib/aws-lambda';
import { conductorProxy } from './functions/conductor-proxy/resource';

const backend = defineBackend({
  conductorProxy,
});

/*
 * Expose the proxy over a Lambda Function URL.
 *
 * authType NONE == publicly reachable, which matches how server.js behaved
 * (anyone who could reach port 4300 could start a workflow). The Conductor
 * credentials still never leave the Lambda. If this ever holds real applicant
 * data, put Cognito or WAF in front of it before going live.
 */
const proxyUrl = backend.conductorProxy.resources.lambda.addFunctionUrl({
  authType: FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ['*'],
    allowedMethods: [HttpMethod.GET, HttpMethod.POST],
    allowedHeaders: ['Content-Type'],
  },
});

backend.addOutput({
  custom: {
    conductorProxyUrl: proxyUrl.url,
  },
});
