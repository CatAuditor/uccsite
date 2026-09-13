# PreToolUse guard: every aws/cdk/ampx shell command must pin the uccsite profile.
# Blocks (exit 2) any Bash/PowerShell command that invokes the AWS CLI, CDK, or
# ampx without `--profile uccsite` or an inline `AWS_PROFILE=uccsite` /
# `$env:AWS_PROFILE = 'uccsite'`. Rationale: the default AWS profile on this
# machine is a personal account; project account is 017110365763 (us-west-2).
# See CLAUDE.md "AWS" section.

$ErrorActionPreference = 'Stop'

try {
    $raw = [Console]::In.ReadToEnd()
    $payload = $raw | ConvertFrom-Json
    $command = $payload.tool_input.command
} catch {
    exit 0  # unparseable input: do not block unrelated tools
}

if (-not $command) { exit 0 }

# Does the command invoke an AWS-credentialed CLI in COMMAND POSITION?
# (start of line/segment, optionally after inline env assignments or npx) —
# not merely the word "aws" appearing inside arguments or commit messages.
# -cmatch: case-SENSITIVE. PowerShell -match is case-insensitive by default,
# which made prose like "; AWS code" inside commit messages trip the guard.
$cmdPos = '(?m)(^|[;&|(]\s*)([A-Za-z_][A-Za-z0-9_]*=\S+\s+)*'
$invokesAws = $command -cmatch ($cmdPos + 'aws(\.exe)?\s') -or
              $command -cmatch ($cmdPos + '(npx(\.cmd)?\s+(-y\s+)?)?(aws-)?cdk(\.cmd)?\s') -or
              $command -cmatch ($cmdPos + '(npx(\.cmd)?\s+(-y\s+)?)?ampx(\.cmd)?\s')

if (-not $invokesAws) { exit 0 }

# Exempt purely local/no-credential aws-cli invocations
if ($command -match '\baws\s+(help|--version)\b' -and $command -notmatch '\baws\s+\w+\s+\w+') { exit 0 }

$pinned = $command -match '--profile[\s=]+uccsite\b' -or
          $command -match 'AWS_PROFILE\s*=\s*[''"]?uccsite[''"]?'

if ($pinned) { exit 0 }

[Console]::Error.WriteLine(@"
BLOCKED: AWS-credentialed command without the uccsite profile.
Every aws / cdk / ampx command must include --profile uccsite (or AWS_PROFILE=uccsite).
The default profile is a PERSONAL account. Project account: 017110365763, us-west-2.
Re-run with the profile pinned. See CLAUDE.md 'AWS' section.
"@)
exit 2
