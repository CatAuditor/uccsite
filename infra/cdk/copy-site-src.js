#!/usr/bin/env node
'use strict';
// Bundling helper for the publish Lambda: copy the site sources into the
// asset's site-src/. Invoked as `node copy-site-src.js <inputDir> <outputDir>`
// by the CDK commandHooks — a script file, not inline `node -e`, because
// backticks/quoting inside inline commands break on non-Windows shells.
// The list comes from aws/publish/inputs.js — the SAME list the publisher
// reads, so the bundle can never miss a file the diff would then delete.
const fs = require('fs');
const path = require('path');
const { SITE_SRC_DIRS, SITE_SRC_FILES } = require('../../aws/publish/inputs');

const [inputDir, outputDir] = process.argv.slice(2);
const dst = path.join(outputDir, 'site-src');
fs.mkdirSync(dst, { recursive: true });
for (const dir of SITE_SRC_DIRS) {
  const src = path.join(inputDir, dir);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(dst, dir), { recursive: true });
}
for (const file of SITE_SRC_FILES) {
  const src = path.join(inputDir, file);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dst, file));
}
console.log(`copied site-src (${SITE_SRC_DIRS.length} dirs, ${SITE_SRC_FILES.length} files)`);
