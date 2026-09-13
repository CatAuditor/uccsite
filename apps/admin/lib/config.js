// Admin app configuration — all from env. Locally, scripts/admin-env.mjs
// writes apps/admin/.env.local from the deployed stack's outputs; on Amplify
// Hosting the same names are console env vars.
function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (run: node scripts/admin-env.mjs --env staging)`);
  return v;
}

export const config = {
  get envName() { return process.env.UCC_ENV || 'staging'; },
  get poolId() { return required('COGNITO_POOL_ID'); },
  get clientId() { return required('COGNITO_CLIENT_ID'); },
  get authDomain() { return required('COGNITO_DOMAIN'); }, // ucc-admin-<env>.auth.<region>.amazoncognito.com
  get dsqlEndpoint() { return required('DSQL_ENDPOINT'); },
  get publishFunctionName() { return required('PUBLISH_FUNCTION_NAME'); },
  get mediaBucket() { return required('MEDIA_BUCKET'); },
  get siteBucket() { return required('SITE_BUCKET'); },        // live css/styles.css for the Style Kit
  get publicOrigin() { return required('PUBLIC_ORIGIN'); },    // <base> for the document preview
  // Repo files the Documents editor reads at runtime (templates/partials,
  // templates/documents, css fallback). Locally the monorepo root; on Amplify
  // amplify.yml copies them into apps/admin/site-src and sets SITE_SRC_ROOT.
  get siteSrcRoot() { return process.env.SITE_SRC_ROOT || require('node:path').join(process.cwd(), '..', '..'); },
  get appOrigin() { return process.env.APP_ORIGIN || 'http://localhost:3000'; },
  get region() { return process.env.UCC_REGION || 'us-west-2'; },
};
