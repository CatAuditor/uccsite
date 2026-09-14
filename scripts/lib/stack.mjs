// THE environment resolver for every CLI script: env name → the deployed
// stack's outputs (bucket, distribution, DSQL endpoint, public origin).
// One copy so a stack/output rename can't silently strand a script on the
// wrong cluster.
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';

export const REGION = 'us-west-2';
const STACKS = { staging: 'UccStaging', prod: 'UccProd' };

// resolveEnv('staging'|'prod', requiredOutputs?) → { region, stackName, accountId, outputs }
// accountId comes from the stack ARN (arn:aws:cloudformation:<region>:<account>:stack/…).
export async function resolveEnv(envName, required = []) {
  const stackName = STACKS[envName];
  if (!stackName) throw new Error(`Unknown env "${envName}" (use: ${Object.keys(STACKS).join(', ')})`);
  const cfn = new CloudFormationClient({ region: REGION });
  const res = await cfn.send(new DescribeStacksCommand({ StackName: stackName }));
  const outputs = Object.fromEntries((res.Stacks[0].Outputs || []).map(o => [o.OutputKey, o.OutputValue]));
  for (const key of required) {
    if (!outputs[key]) throw new Error(`Stack ${stackName} is missing output ${key}`);
  }
  const accountId = res.Stacks[0].StackId.split(':')[4];
  return { region: REGION, stackName, accountId, outputs };
}

// argValue(args, '--name', default?) — safe against absent flags (indexOf -1).
export function argValue(args, name, def) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : def;
}
