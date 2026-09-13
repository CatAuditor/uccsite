'use strict';
// One stack per environment (UccStaging / UccProd): S3 site bucket + CloudFront
// (OAC, response-headers policies, viewer-request function + KVS redirects),
// Aurora DSQL, and the /api/* Lambda Function URL origin with a secret origin
// lock. See docs/build-spec-aws.md §2, §8 and planning addenda 4/10.
const path = require('path');
const fs = require('fs');
const {
  Stack, Duration, RemovalPolicy, CfnOutput, SecretValue,
  aws_s3: s3,
  aws_cloudfront: cloudfront,
  aws_cloudfront_origins: origins,
  aws_lambda: lambda,
  aws_lambda_nodejs: nodejs,
  aws_iam: iam,
  aws_secretsmanager: secretsmanager,
  aws_dsql: dsql,
  aws_sns: sns,
  aws_events: events,
  aws_events_targets: targets,
  aws_cloudwatch: cloudwatch,
  aws_cloudwatch_actions: cwActions,
} = require('aws-cdk-lib');
const { Construct } = require('constructs');

const SECURITY_HEADERS = {
  contentTypeOptions: { override: true },
  frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
  referrerPolicy: {
    referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
    override: true,
  },
  strictTransportSecurity: {
    accessControlMaxAge: Duration.days(365),
    includeSubdomains: true,
    preload: true,
    override: true,
  },
};

// Site-wide CSP: static/_headers posture minus the Cloudflare Insights origins
// (the beacon was edge-injected by Cloudflare and never part of repo output),
// plus challenges.cloudflare.com for the Turnstile widget on the join/tip
// forms (spec §10's one net-new abuse control).
const SITE_CSP = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self'",
  "frame-src https://www.youtube.com https://challenges.cloudflare.com",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

// Decap CMS shell under /admin/* (retires in Phase 7) — needs inline/eval
// scripts and the GitHub API, exactly as static/_headers grants today.
const ADMIN_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://api.github.com https://github.com https://raw.githubusercontent.com",
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=()';

class UccStack extends Stack {
  /** @param {Construct} scope @param {string} id @param {{isProd: boolean, basicAuth?: string} & import('aws-cdk-lib').StackProps} props */
  constructor(scope, id, props) {
    super(scope, id, props);
    const { isProd, basicAuth } = props;

    // ── Site bucket ─────────────────────────────────────────────────────────
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true, // §14.1 — every publish leaves the prior bytes recoverable
      lifecycleRules: [{ noncurrentVersionExpiration: Duration.days(365) }],
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
    });

    // ── Aurora DSQL (no VPC — keeps the Lambda VPC-free, §1.2) ─────────────
    const cluster = new dsql.CfnCluster(this, 'Database', {
      deletionProtectionEnabled: isProd,
      tags: [{ key: 'project', value: 'uccsite' }, { key: 'env', value: isProd ? 'prod' : 'staging' }],
    });
    const dsqlEndpoint = `${cluster.attrIdentifier}.dsql.${this.region}.on.aws`;

    // ── Origin lock secret (planning addendum 4: no OAC on Function URLs — a
    // SigV4-signed POST needs x-amz-content-sha256, which Stripe and browsers
    // won't send). CloudFront stamps this header; the Lambda requires it.
    // Resolved at deploy via a CloudFormation dynamic reference — the value
    // never enters the synthesized template or this session.
    const originVerifySecret = new secretsmanager.Secret(this, 'OriginVerifySecret', {
      description: 'Shared header value proving /api/* requests came through CloudFront',
      generateSecretString: { excludePunctuation: true, passwordLength: 40 },
    });
    const originVerifyValue = originVerifySecret.secretValue.unsafeUnwrap(); // renders as {{resolve:secretsmanager:...}}

    // ── API secrets (spec §17): created with placeholders, values entered by
    // the operator in the console (docs/for-conner.md). The Lambda fetches
    // them AT RUNTIME (aws/api/secrets.js) — values never enter the template
    // or the Lambda env, and rotation needs no redeploy.
    // Single source: the Lambda's own secret list drives what CDK creates,
    // so a name added in one place can't silently miss the other.
    const { NAMES: API_SECRET_NAMES, PLACEHOLDER } = require('../../../aws/api/secrets.js');
    const envName = isProd ? 'prod' : 'staging';
    const publicOrigin = isProd
      ? 'https://utahciviccompact.org'
      : this.node.tryGetContext('stagingPublicOrigin');
    if (!publicOrigin) {
      throw new Error(
        'stagingPublicOrigin is not set in cdk.json context. After the first deploy of a '
        + 'staging distribution, set it to https://<its-domain>.cloudfront.net - without it, '
        + 'email links and Stripe redirect URLs would point at the raw Function URL, which '
        + 'the origin lock rejects.');
    }
    const apiSecrets = {};
    for (const name of API_SECRET_NAMES) {
      apiSecrets[name] = new secretsmanager.Secret(this, `ApiSecret${name}`, {
        secretName: `ucc/${envName}/${name}`,
        description: `uccsite ${envName} ${name} (fill in the real value; see docs/for-conner.md)`,
        secretStringValue: SecretValue.unsafePlainText(PLACEHOLDER),
        removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      });
    }

    // ── API Lambda (functions/api port — aws/api, spec §10) ─────────────────
    const apiFn = new nodejs.NodejsFunction(this, 'ApiFunction', {
      entry: path.join(__dirname, '..', '..', '..', 'aws', 'api', 'index.mjs'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(20),
      environment: {
        DSQL_ENDPOINT: dsqlEndpoint,
        ORIGIN_VERIFY_SECRET: originVerifyValue,
        // Public site origin for links in emails and Stripe redirects. The
        // staging value is the distribution's stable *.cloudfront.net domain,
        // set in cdk.json context after the first deploy (can't reference the
        // distribution here — that would be a CFN cycle through the origin).
        // publicOrigin is validated non-empty below — an empty value would
        // put Function URL hosts into email links, which the origin lock 403s.
        PUBLIC_ORIGIN: publicOrigin,
        ...Object.fromEntries(API_SECRET_NAMES.map(n => [`SECRET_ARN_${n}`, apiSecrets[n].secretArn])),
      },
      bundling: {
        externalModules: ['pg-native'], // optional native dep of pg, not installed
      },
      depsLockFilePath: path.join(__dirname, '..', '..', '..', 'package-lock.json'),
    });
    apiFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dsql:DbConnectAdmin'],
      resources: [cluster.attrResourceArn],
    }));
    for (const name of API_SECRET_NAMES) apiSecrets[name].grantRead(apiFn);
    // Async self-invocation (portal magic-link job). A STANDALONE policy, not
    // addToRolePolicy: CDK makes the function DependsOn its role's default
    // policy, so putting our own ARN there is a circular dependency.
    new iam.Policy(this, 'ApiSelfInvokePolicy', {
      roles: [apiFn.role],
      statements: [new iam.PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: [apiFn.functionArn, `${apiFn.functionArn}:*`],
      })],
    });
    const apiUrl = apiFn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });

    // ── CloudFront Function + KVS redirect map ──────────────────────────────
    const redirectStore = new cloudfront.KeyValueStore(this, 'RedirectStore', {
      source: cloudfront.ImportSource.fromAsset(path.join(__dirname, '..', 'kvs', 'redirects.json')),
    });
    const fnCode = fs
      .readFileSync(path.join(__dirname, '..', 'cf-fn', 'viewer-request.js'), 'utf8')
      .replace('__BASIC_AUTH__', basicAuth ? 'Basic ' + Buffer.from(basicAuth).toString('base64') : '');
    const viewerRequestFn = new cloudfront.Function(this, 'ViewerRequestFn', {
      code: cloudfront.FunctionCode.fromInline(fnCode),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      keyValueStore: redirectStore,
      comment: 'clean URLs, .html 308s, redirect map, staging basic auth',
    });

    // ── Response headers ────────────────────────────────────────────────────
    const stagingNoindex = isProd ? [] : [
      { header: 'X-Robots-Tag', value: 'noindex, nofollow', override: true },
    ];
    const siteHeaders = new cloudfront.ResponseHeadersPolicy(this, 'SiteHeaders', {
      securityHeadersBehavior: {
        ...SECURITY_HEADERS,
        contentSecurityPolicy: { contentSecurityPolicy: SITE_CSP, override: true },
      },
      customHeadersBehavior: {
        customHeaders: [
          { header: 'Permissions-Policy', value: PERMISSIONS_POLICY, override: true },
          ...stagingNoindex,
        ],
      },
    });
    const adminHeaders = new cloudfront.ResponseHeadersPolicy(this, 'AdminHeaders', {
      securityHeadersBehavior: {
        ...SECURITY_HEADERS,
        contentSecurityPolicy: { contentSecurityPolicy: ADMIN_CSP, override: true },
      },
      customHeadersBehavior: {
        customHeaders: [
          { header: 'Permissions-Policy', value: PERMISSIONS_POLICY, override: true },
          { header: 'X-Robots-Tag', value: 'noindex, nofollow', override: true },
          { header: 'Cache-Control', value: 'no-store', override: true },
        ],
      },
    });

    // ── Distribution ────────────────────────────────────────────────────────
    const siteOrigin = origins.S3BucketOrigin.withOriginAccessControl(siteBucket);
    const siteBehaviorBase = {
      origin: siteOrigin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      functionAssociations: [{
        function: viewerRequestFn,
        eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
      }],
    };
    const adminBehavior = {
      ...siteBehaviorBase,
      responseHeadersPolicy: adminHeaders,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
    };
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `uccsite ${isProd ? 'prod' : 'staging'}`,
      defaultBehavior: { ...siteBehaviorBase, responseHeadersPolicy: siteHeaders },
      additionalBehaviors: {
        // Exact '/admin' (matching is on the ORIGINAL URI, before the viewer
        // function rewrites it to /admin/index.html) plus '/admin/*'. NOT a
        // single '/admin*' — that would pull any future /admin-... page under
        // the loosened Decap policy. CACHING_DISABLED matches the no-store
        // header (with CACHING_OPTIMIZED the edge cached the shell for 24h
        // while telling browsers not to).
        '/admin': { ...adminBehavior },
        '/admin/*': { ...adminBehavior },
        '/api/*': {
          origin: new origins.FunctionUrlOrigin(apiUrl, {
            customHeaders: { 'x-origin-verify': originVerifyValue },
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          // Forwards every viewer header except Host (a Function URL origin
          // requires its own Host). Client IP: CloudFront appends the real
          // connecting IP as the LAST entry of X-Forwarded-For.
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      // OAC without ListBucket: a missing key is S3 403. Map both to the real 404 page.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 404, responsePagePath: '/404.html', ttl: Duration.minutes(1) },
        { httpStatus: 404, responseHttpStatus: 404, responsePagePath: '/404.html', ttl: Duration.minutes(1) },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      // Custom domain + ACM cert attach at cutover (Phase 6).
    });

    // ── Drift reconciler (§7): hourly manifest-vs-live check, restores from
    // version history, invalidates, alerts. Expected state comes from the
    // publish_runs table the publish pipeline writes.
    const alertTopic = new sns.Topic(this, 'OpsAlerts', {
      displayName: `uccsite ${isProd ? 'prod' : 'staging'} ops alerts`,
    });
    const reconcileFn = new nodejs.NodejsFunction(this, 'ReconcileDriftFn', {
      entry: path.join(__dirname, '..', '..', '..', 'aws', 'reconcile-drift', 'index.mjs'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.minutes(5),
      environment: {
        SITE_BUCKET: siteBucket.bucketName,
        DISTRIBUTION_ID: distribution.distributionId,
        DSQL_ENDPOINT: dsqlEndpoint,
        ALERT_TOPIC_ARN: alertTopic.topicArn,
      },
      bundling: { externalModules: ['pg-native'] },
      depsLockFilePath: path.join(__dirname, '..', '..', '..', 'package-lock.json'),
    });
    siteBucket.grantReadWrite(reconcileFn);
    reconcileFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:ListBucketVersions'],
      resources: [siteBucket.bucketArn],
    }));
    reconcileFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObjectVersion'],
      resources: [siteBucket.arnForObjects('*')],
    }));
    reconcileFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cloudfront:CreateInvalidation'],
      resources: [`arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`],
    }));
    reconcileFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dsql:DbConnectAdmin'],
      resources: [cluster.attrResourceArn],
    }));
    alertTopic.grantPublish(reconcileFn);
    new events.Rule(this, 'ReconcileHourly', {
      schedule: events.Schedule.rate(Duration.hours(1)),
      targets: [new targets.LambdaFunction(reconcileFn)],
    });
    // A reconciler that cannot run is itself an incident: alarm its Errors
    // metric into the same ops topic (the handler also alerts before
    // rethrowing, but a crash pre-alert must still reach a human).
    reconcileFn.metricErrors({ period: Duration.hours(1), statistic: 'Sum' })
      .createAlarm(this, 'ReconcileErrorsAlarm', {
        threshold: 1,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: 'uccsite drift reconciler failed to run',
      })
      .addAlarmAction(new cwActions.SnsAction(alertTopic));

    // ── Operational data export (§14.3): nightly donor/newsletter snapshot
    // to a RESTRICTED private bucket. 90-day retention; never to git.
    const exportBucket = new s3.Bucket(this, 'OperationalExportBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      // BOTH rules: without noncurrentVersionExpiration the versioned bucket
      // keeps every expired PII export forever as a noncurrent version —
      // the opposite of the 90-day retention the policy promises.
      lifecycleRules: [{
        expiration: Duration.days(90),
        noncurrentVersionExpiration: Duration.days(7),
      }],
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
    });
    const exportFn = new nodejs.NodejsFunction(this, 'ExportOperationalFn', {
      entry: path.join(__dirname, '..', '..', '..', 'aws', 'export-operational', 'index.mjs'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.minutes(5),
      environment: {
        EXPORT_BUCKET: exportBucket.bucketName,
        DSQL_ENDPOINT: dsqlEndpoint,
        ALERT_TOPIC_ARN: alertTopic.topicArn,
      },
      bundling: { externalModules: ['pg-native'] },
      depsLockFilePath: path.join(__dirname, '..', '..', '..', 'package-lock.json'),
    });
    exportBucket.grantWrite(exportFn);
    exportFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dsql:DbConnectAdmin'],
      resources: [cluster.attrResourceArn],
    }));
    alertTopic.grantPublish(exportFn);
    new events.Rule(this, 'ExportOperationalNightly', {
      schedule: events.Schedule.cron({ minute: '0', hour: '9' }), // 09:00 UTC ~ 3am MT
      targets: [new targets.LambdaFunction(exportFn)],
    });
    exportFn.metricErrors({ period: Duration.days(1), statistic: 'Sum' })
      .createAlarm(this, 'ExportErrorsAlarm', {
        threshold: 1,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: 'uccsite operational export failed',
      })
      .addAlarmAction(new cwActions.SnsAction(alertTopic));

    // ── Publish Lambda (Phase 7): admin-triggered render+publish, content
    // from DSQL, site sources (templates/css/js/assets/static) bundled into
    // the asset by the commandHooks below. Async invoke; the admin polls
    // publish_runs for the Draft/Publishing/Live/Failed state.
    const siteSrcDirs = ['templates', 'css', 'js', 'assets', 'static'];
    const siteSrcFiles = ['robots.txt', 'llms.txt', 'favicon.svg', 'UCC.png'];
    const repoRoot = path.join(__dirname, '..', '..', '..');
    const publishFn = new nodejs.NodejsFunction(this, 'PublishFn', {
      entry: path.join(repoRoot, 'aws', 'publish', 'handler.mjs'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512,
      timeout: Duration.minutes(10),
      environment: {
        SITE_BUCKET: siteBucket.bucketName,
        DISTRIBUTION_ID: distribution.distributionId,
        DSQL_ENDPOINT: dsqlEndpoint,
      },
      bundling: {
        externalModules: ['pg-native'],
        commandHooks: {
          beforeBundling: () => [],
          beforeInstall: () => [],
          afterBundling: (inputDir, outputDir) => {
            // Windows-safe copies of the site sources next to the bundle.
            const src = (p) => path.join(inputDir, p);
            const dst = path.join(outputDir, 'site-src');
            const cmds = [`node -e "require('fs').mkdirSync(String.raw\`${dst}\`, {recursive:true})"`];
            for (const dir of siteSrcDirs) {
              cmds.push(`node -e "require('fs').cpSync(String.raw\`${src(dir)}\`, String.raw\`${path.join(dst, dir)}\`, {recursive:true})"`);
            }
            for (const file of siteSrcFiles) {
              cmds.push(`node -e "require('fs').copyFileSync(String.raw\`${src(file)}\`, String.raw\`${path.join(dst, file)}\`)"`);
            }
            return cmds;
          },
        },
      },
      depsLockFilePath: path.join(repoRoot, 'package-lock.json'),
    });
    siteBucket.grantReadWrite(publishFn);
    publishFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cloudfront:CreateInvalidation', 'cloudfront:GetInvalidation'],
      resources: [`arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`],
    }));
    publishFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dsql:DbConnectAdmin'],
      resources: [cluster.attrResourceArn],
    }));

    // ── Cognito (spec §11): email login, invite-only (no self-signup —
    // operators use AdminCreateUser), optional TOTP, owner/editor/viewer.
    const { aws_cognito: cognito } = require('aws-cdk-lib');
    const userPool = new cognito.UserPool(this, 'AdminUserPool', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      passwordPolicy: { minLength: 12 },
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });
    for (const group of ['owner', 'editor', 'viewer']) {
      new cognito.CfnUserPoolGroup(this, `Group${group}`, {
        userPoolId: userPool.userPoolId,
        groupName: group,
      });
    }
    const userPoolDomain = userPool.addDomain('AdminAuthDomain', {
      cognitoDomain: { domainPrefix: `ucc-admin-${envName}` },
    });
    const adminClient = userPool.addClient('AdminAppClient', {
      generateSecret: false, // public client + PKCE; the Next.js server does the code exchange
      authFlows: { userSrp: true, userPassword: true }, // userPassword: scripted smoke tests

      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: [
          'http://localhost:3000/auth/callback',
          ...(isProd ? ['https://admin.utahciviccompact.org/auth/callback'] : []),
        ],
        logoutUrls: [
          'http://localhost:3000/login',
          ...(isProd ? ['https://admin.utahciviccompact.org/login'] : []),
        ],
      },
    });

    new CfnOutput(this, 'PublishFunctionName', { value: publishFn.functionName });
    new CfnOutput(this, 'AdminUserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'AdminUserPoolClientId', { value: adminClient.userPoolClientId });
    new CfnOutput(this, 'AdminAuthDomain', { value: `${userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com` });
    new CfnOutput(this, 'OperationalExportBucketName', { value: exportBucket.bucketName });
    new CfnOutput(this, 'PublicOrigin', { value: publicOrigin });
    new CfnOutput(this, 'OpsAlertTopicArn', { value: alertTopic.topicArn });
    new CfnOutput(this, 'DistributionDomain', { value: distribution.distributionDomainName });
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    new CfnOutput(this, 'SiteBucketName', { value: siteBucket.bucketName });
    new CfnOutput(this, 'DsqlEndpoint', { value: dsqlEndpoint });
    new CfnOutput(this, 'RedirectStoreArn', { value: redirectStore.keyValueStoreArn });
  }
}

module.exports = { UccStack };
