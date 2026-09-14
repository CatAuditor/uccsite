#!/usr/bin/env node
// admin-user.mjs — create (invite) an admin user in an environment's Cognito
// pool and put them in a role group. Cognito emails the temporary password;
// first sign-in forces a new one. Idempotent: an existing user only gets the
// group/name updated.
//
// Usage: $env:AWS_PROFILE='uccsite'; node scripts/admin-user.mjs --env staging \
//          --email jarom.gillins@utahciviccompact.org --name "Jarom Gillins" --group owner
//        add --resend to re-send the invite to a user who never signed in.
import {
  CognitoIdentityProviderClient, AdminCreateUserCommand, AdminGetUserCommand, AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand, AdminListGroupsForUserCommand, AdminUpdateUserAttributesCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { resolveEnv, argValue } from './lib/stack.mjs';

const args = process.argv.slice(2);
const envName = argValue(args, '--env', 'staging');
const email = (argValue(args, '--email', '') || '').toLowerCase();
const name = argValue(args, '--name', '');
const group = argValue(args, '--group', 'editor');
const resend = args.includes('--resend');
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error('--email required'); process.exit(2); }
if (!['owner', 'editor', 'viewer'].includes(group)) { console.error('--group must be owner|editor|viewer'); process.exit(2); }

const { region, outputs, stackName } = await resolveEnv(envName, ['AdminUserPoolId']);
const cognito = new CognitoIdentityProviderClient({ region });
const UserPoolId = outputs.AdminUserPoolId;

let user;
try {
  user = await cognito.send(new AdminGetUserCommand({ UserPoolId, Username: email }));
  console.log(`exists: ${email} (${user.UserStatus})`);
  if (name) await cognito.send(new AdminUpdateUserAttributesCommand({ UserPoolId, Username: email, UserAttributes: [{ Name: 'name', Value: name }] }));
  if (resend && user.UserStatus === 'FORCE_CHANGE_PASSWORD') {
    await cognito.send(new AdminCreateUserCommand({ UserPoolId, Username: email, MessageAction: 'RESEND', DesiredDeliveryMediums: ['EMAIL'] }));
    console.log('invite re-sent');
  }
} catch (err) {
  if (err.name !== 'UserNotFoundException') throw err;
  const res = await cognito.send(new AdminCreateUserCommand({
    UserPoolId, Username: email, DesiredDeliveryMediums: ['EMAIL'],
    UserAttributes: [{ Name: 'email', Value: email }, { Name: 'email_verified', Value: 'true' }, ...(name ? [{ Name: 'name', Value: name }] : [])],
  }));
  console.log(`created: ${email} (${res.User.UserStatus}) — temporary password emailed`);
}
const groups = (await cognito.send(new AdminListGroupsForUserCommand({ UserPoolId, Username: email }))).Groups?.map(g => g.GroupName) || [];
for (const g of groups) if (['owner', 'editor', 'viewer'].includes(g) && g !== group) {
  await cognito.send(new AdminRemoveUserFromGroupCommand({ UserPoolId, Username: email, GroupName: g }));
}
if (!groups.includes(group)) await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId, Username: email, GroupName: group }));
console.log(`${email} is ${group} in ${stackName} (${UserPoolId})`);
