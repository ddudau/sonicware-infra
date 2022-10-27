#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { SonicwareInfraStack } from '../lib/sonicware-infra-stack';
import { identifyResource } from '../lib/config-util';

const app = new cdk.App();
const accountId = '585331535030';
const region = 'eu-central-1';

const staticSiteResourcePrefix = 'cdk-web-static';
const STATIC_SITE_BUCKET_NAME_OUTPUT_ID = identifyResource(staticSiteResourcePrefix, 'bucket-name');
const STATIC_SITE_DISTRIBUTION_ID_OUTPUT_ID = identifyResource(staticSiteResourcePrefix, 'distribution-id');

new SonicwareInfraStack(app, 'SonicwareInfraStack', {
  env: {
    account: accountId,
    region: region,
  },
  resourcePrefix: staticSiteResourcePrefix,
  hostedZoneName: 'sonicware.pro',
  domainName: 'sonicware.pro',
  includeWWW: true,
  siteSourcePath: '../dist',
  staticSiteBucketNameOutputId: STATIC_SITE_BUCKET_NAME_OUTPUT_ID,
  staticSiteDistributionIdOutputId: STATIC_SITE_DISTRIBUTION_ID_OUTPUT_ID
});