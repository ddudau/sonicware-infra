import { Aws, CfnOutput, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { DnsValidatedCertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { CloudFrontAllowedMethods, CloudFrontWebDistribution, OriginAccessIdentity, SecurityPolicyProtocol, SSLMethod, ViewerCertificate } from 'aws-cdk-lib/aws-cloudfront';
import { Metric } from 'aws-cdk-lib/aws-cloudwatch';
import { CanonicalUserPrincipal, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { ARecord, HostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { BlockPublicAccess, Bucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { identifyResource } from './config-util';

export interface SonicwareProps extends StackProps {
  readonly resourcePrefix: string;
  readonly hostedZoneName: string;
  readonly domainName: string;
  readonly includeWWW: boolean;
  readonly siteSourcePath: string;
  readonly staticSiteBucketNameOutputId: string;
  readonly staticSiteDistributionIdOutputId: string;
}

/**
 * Infrastructure that hosts a static site on an S3 bucket.
 * The site enforces HTTPS, using a CloudFront distribution, Route53 alias record, and ACM certificate.
 */
export class SonicwareInfraStack extends Stack {
  constructor(scope: Construct, id: string, props: SonicwareProps) {
    super(scope, id, props);

    // Get Hosted Zone
    const zone = HostedZone.fromLookup(this, identifyResource(props.resourcePrefix, 'hosted-zone'), { domainName: props.hostedZoneName });
    const siteDomain = props.domainName;
    const fullSiteDomain = `www.${siteDomain}`;
    const cloudfrontOAI = new OriginAccessIdentity(this, identifyResource(props.resourcePrefix, 'cloudfront-OAI'), {
      comment: `OAI for ${id}`
    });

    // Create an s3 bucket for the static content
    const siteBucket = new Bucket(this, identifyResource(props.resourcePrefix, 'site-bucket'), {
      bucketName: siteDomain,
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'error.html',
      publicReadAccess: false,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,

      // !!! CAUTION: setting this to true will destroy the entire S3 bucket in case of failure / destruction (unless it is not empty)
      removalPolicy: RemovalPolicy.DESTROY, // NOT recommended for production code

      // !!! CAUTION: setting this to true will clear the entire S3 bucket in case of failure / destruction
      autoDeleteObjects: true, // NOT recommended for production code
    });

    // Grant access to cloudfront
    siteBucket.addToResourcePolicy(new PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [siteBucket.arnForObjects('*')],
      principals: [new CanonicalUserPrincipal(cloudfrontOAI.cloudFrontOriginAccessIdentityS3CanonicalUserId)]
    }));
    new CfnOutput(this, props.staticSiteBucketNameOutputId, { value: siteBucket.bucketName, exportName: props.staticSiteBucketNameOutputId });

    // Create TLS certificate + automatic DNS validation
    const certificateArn = new DnsValidatedCertificate(this, identifyResource(props.resourcePrefix, 'site-certificate'), {
      domainName: siteDomain,
      hostedZone: zone,
      region: 'us-east-1', // Cloudfront only checks this region for certificates.
      subjectAlternativeNames: props.includeWWW ? [fullSiteDomain] : []
    }).certificateArn;

    // Create a CloudFront viewer certificate enforcing usage of HTTPS & TLS v1.2
    const viewerCertificate = ViewerCertificate.fromAcmCertificate({
      certificateArn: certificateArn,
      env: {
        region: Aws.REGION,
        account: Aws.ACCOUNT_ID
      },
      node: this.node,
      stack: this,
      metricDaysToExpiry: () =>
        new Metric({
          namespace: 'TLS Viewer Certificate Validity',
          metricName: 'TLS Viewer Certificate Expired',
        }),
      applyRemovalPolicy: (policy: RemovalPolicy) => {
      }
    }, {
      sslMethod: SSLMethod.SNI,
      securityPolicy: SecurityPolicyProtocol.TLS_V1_2_2021,
      aliases: props.includeWWW ? [siteDomain, fullSiteDomain] : [siteDomain],
    })

    // Set up the CloudFront distribution
    const distribution = new CloudFrontWebDistribution(this, identifyResource(props.resourcePrefix, 'site-distribution'), {
      viewerCertificate,
      originConfigs: [
        {
          s3OriginSource: {
            s3BucketSource: siteBucket,
            originAccessIdentity: cloudfrontOAI
          },
          behaviors: [{
            isDefaultBehavior: true,
            compress: true,
            allowedMethods: CloudFrontAllowedMethods.GET_HEAD_OPTIONS,
          }],
        }
      ],
      errorConfigurations: [
        {
          errorCode: 403,
          errorCachingMinTtl: 10,
          responseCode: 200,
          responsePagePath: '/index.html'
        },
        {
          errorCode: 400,
          errorCachingMinTtl: 10,
          responseCode: 200,
          responsePagePath: '/index.html'
        }
      ]
    });
    new CfnOutput(this, props.staticSiteDistributionIdOutputId, { value: distribution.distributionId, exportName: props.staticSiteDistributionIdOutputId });

    // Set up Route53 aliases records for the CloudFront distribution
    new ARecord(this, identifyResource(props.resourcePrefix, 'site-alias-record-01'), {
      recordName: siteDomain,
      target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
      zone
    });

    if (props.includeWWW) {
      new ARecord(this, identifyResource(props.resourcePrefix, 'site-alias-record-02'), {
        recordName: fullSiteDomain,
        target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
        zone
      });
    }
  }
}
