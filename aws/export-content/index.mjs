// Nightly content export to git (build-spec-aws.md §14.2): the content
// tables → content/*.json (+ manifest.json) → ONE commit on EXPORT_BRANCH of
// GITHUB_REPO via a GitHub App installation token, only when a content file
// actually changed. Operational tables are never touched here (§14.3 has its
// own restricted bucket export). The GitHub App credentials come from
// Secrets Manager at run time; while they still hold the CDK placeholder the
// run logs "skipped" and does nothing — no alarm, no retry.
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { withConnection } from '@uccsite/db';
import { loadContent } from '@uccsite/db/content';
import { buildContentExport, changedPaths } from '@uccsite/db/export';
import { installationToken, remoteBlobShas, commitFiles } from './github.mjs';
import { SECRET_NAMES } from './secret-names.cjs';

const { DSQL_ENDPOINT, GITHUB_REPO, EXPORT_BRANCH, ALERT_TOPIC_ARN } = process.env;
const region = process.env.AWS_REGION;
const PLACEHOLDER = 'REPLACE_ME';

const sm = new SecretsManagerClient({ region });
const sns = new SNSClient({ region });

async function loadGithubSecrets() {
  const out = {};
  for (const name of SECRET_NAMES) {
    const arn = process.env[`SECRET_ARN_${name}`];
    if (!arn) return null;
    const res = await sm.send(new GetSecretValueCommand({ SecretId: arn }));
    if (!res.SecretString || res.SecretString === PLACEHOLDER) return null;
    out[name] = res.SecretString;
  }
  return out;
}

async function alert(subject, message) {
  if (!ALERT_TOPIC_ARN) return;
  try {
    await sns.send(new PublishCommand({ TopicArn: ALERT_TOPIC_ARN, Subject: subject.slice(0, 99), Message: message }));
  } catch (err) {
    console.error(`[export-content] alert publish failed: ${err.message}`);
  }
}

export async function handler() {
  const started = new Date().toISOString();
  try {
    const secrets = await loadGithubSecrets();
    if (!secrets) {
      console.warn('[export-content] GitHub App secrets unset (placeholder) — export skipped');
      return { status: 'skipped', reason: 'secrets unset' };
    }
    const content = await withConnection({ endpoint: DSQL_ENDPOINT, region }, (client) => loadContent(client));
    const files = buildContentExport(content, { exportedAt: started });

    const token = await installationToken({
      appId: secrets.GITHUB_APP_ID,
      installationId: secrets.GITHUB_APP_INSTALLATION_ID,
      privateKeyPem: secrets.GITHUB_APP_PRIVATE_KEY,
    });
    const remote = await remoteBlobShas({ token, repo: GITHUB_REPO, branch: EXPORT_BRANCH, paths: [...files.keys()] });
    const changed = changedPaths(files, remote);
    if (!changed.length) {
      console.log(`[export-content] no content change vs ${GITHUB_REPO}@${EXPORT_BRANCH} — nothing committed`);
      return { status: 'noop', files: files.size };
    }
    const { sha, created } = await commitFiles({
      token, repo: GITHUB_REPO, branch: EXPORT_BRANCH, files, changed,
      message: `content export ${started.slice(0, 10)}: ${changed.map(p => p.replace(/^content\//, '').replace(/\.json$/, '')).join(', ')}`,
      author: { name: 'uccsite content export', email: 'noreply@utahciviccompact.org' },
    });
    console.log(`[export-content] committed ${sha.slice(0, 7)} on ${EXPORT_BRANCH}${created ? ' (branch created)' : ''}: ${changed.join(', ')}`);
    return { status: 'committed', sha, changed };
  } catch (err) {
    console.error(`[export-content] failed: ${err.message}`);
    await alert('uccsite content export failed', `${started}\n${err.message}`);
    throw err;
  }
}
