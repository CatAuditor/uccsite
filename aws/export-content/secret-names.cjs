'use strict';
// The GitHub App secrets the content export needs. ONE list read by both the
// CDK stack (creates the placeholders, grants read) and the Lambda (loads
// them) — a name added in one place cannot silently miss the other.
const SECRET_NAMES = ['GITHUB_APP_ID', 'GITHUB_APP_INSTALLATION_ID', 'GITHUB_APP_PRIVATE_KEY'];
module.exports = { SECRET_NAMES };
