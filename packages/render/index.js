'use strict';

const engine = require('./engine');
const site = require('./site');

const documents = require('./documents');
const dates = require('./dates');
const projects = require('./projects');
const press = require('./press');
const petitions = require('./petitions');
module.exports = { ...engine, ...site, ...dates, ...projects, ...press, ...petitions, documents };
