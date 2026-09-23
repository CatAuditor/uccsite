# 2026-09-23 — UccProd deploy fails creating the Cognito user pool

## Error

```
11:32:31 AM | CREATE_FAILED | AWS::Cognito::UserPool | AdminUserPool
Resource handler returned message: "RelyingPartyId cannot be reserved domain
other than User Pool's prefix domain (Service: CognitoIdentityProvider,
Status Code: 400)" (HandlerErrorCode: InvalidRequest)
```

The stack rolled back to `UPDATE_ROLLBACK_COMPLETE` with its original eight
outputs. Nothing was orphaned.

## Cause

`infra/cdk/lib/ucc-stack.js` set the WebAuthn relying party to the pool's own
managed-login domain:

```js
const authDomainName = `ucc-admin-${envName}.auth.${this.region}.amazoncognito.com`;
// ...
passkeyRelyingPartyId: authDomainName,
```

That domain belongs to a separate `AWS::Cognito::UserPoolDomain` resource which
does not exist when the pool itself is created. Cognito treats
`*.amazoncognito.com` as reserved and accepts it as a relying party only when it
already matches the pool's own prefix domain — so the value can never be valid
at pool-creation time.

**Why staging never hit it.** The staging pool was created before this line was
added (commit `0abf3f2`, 2026-09-13). Later stack updates did not re-apply the
setting, so the deployed pool never carried it:

```
$ aws cognito-idp describe-user-pool --user-pool-id us-west-2_d9xGDwxVC \
    --query 'UserPool.[WebAuthnRelyingPartyID,WebAuthnUserVerification]'
None    None
```

`UccProd` was the first genuine `CREATE` of a pool with this code, so it was the
first to validate the value. The setting had never actually taken effect
anywhere.

## Fix

Removed `passkeyRelyingPartyId` and `passkeyUserVerification`, and the now-unused
`authDomainName` const. `signInPolicy.allowedFirstAuthFactors` still enables
passkeys as a first-factor option.

Left unset, the relying party is the domain serving the login page — the
configuration staging has run under since it was built and signed off.

`cdk diff UccStaging` after the change shows only a template-level cleanup:

```
[~] AWS::Cognito::UserPool AdminUserPool
 ├─ [-] WebAuthnRelyingPartyID
 └─ [-] WebAuthnUserVerification
```

Both were already absent from the live pool, so staging behavior does not change.

## Open follow-up

When `admin.utahciviccompact.org` exists (`docs/for-conner.md` §7.1, §8), decide
whether to pin the relying party to it. Set it in a second pass, after the
domain resource exists — not on the pool at creation. Moving a relying party
invalidates passkeys already registered against the old one, so do it before
operators enroll, not after.

## What would have caught this earlier

An infrastructure setting can be present in the CDK source, deploy without
error, and still not exist on the deployed resource — a property added to an
already-created resource may be silently skipped on update. Verifying a security
setting means reading it back from the live resource
(`aws cognito-idp describe-user-pool`), not seeing a clean deploy.

The same gap has a second edge: `UccStaging` had been green for ten days with a
security feature the code claimed to configure and the pool did not have.
