'use strict';
// CommonJS shim: the parser lives in dates.mjs (ESM) so the admin's client
// bundle can import it; Node >= 22.12 can require() an ESM module directly.
module.exports = require('./dates.mjs');
