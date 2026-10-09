// @uccsite/doc-blocks — the document builder's model (docs/systems/document-builder.md).
'use strict';
const schema = require('./schema');
const { serialize, renderBlock, renderSection, sampleHtml, sectionAnchor } = require('./serialize');
const { parse } = require('./parse');

module.exports = { ...schema, serialize, renderBlock, renderSection, sampleHtml, sectionAnchor, parse };
