'use strict';

const engine = require('./engine');
const site = require('./site');

const documents = require('./documents');
const dates = require('./dates');
module.exports = { ...engine, ...site, ...dates, documents };
