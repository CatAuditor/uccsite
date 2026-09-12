#!/usr/bin/env node
'use strict';
const { App } = require('aws-cdk-lib');
const { UccStack } = require('../lib/ucc-stack');

const app = new App();
const account = app.node.tryGetContext('account');
const region = app.node.tryGetContext('region');
const env = { account, region };

new UccStack(app, 'UccStaging', {
  env,
  isProd: false,
  basicAuth: app.node.tryGetContext('stagingBasicAuth'),
  description: 'uccsite staging: CloudFront + S3 + DSQL + API Lambda',
});

new UccStack(app, 'UccProd', {
  env,
  isProd: true,
  description: 'uccsite production: CloudFront + S3 + DSQL + API Lambda',
});
