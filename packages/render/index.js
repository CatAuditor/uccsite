'use strict';

const engine = require('./engine');
const site = require('./site');

const documents = require('./documents');
const dates = require('./dates');
const projects = require('./projects');
const press = require('./press');
module.exports = { ...engine, ...site, ...dates, ...projects, ...press, documents };
