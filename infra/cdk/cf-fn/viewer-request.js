// CloudFront Function (viewer-request, runtime 2.0).
// Reproduces the live Cloudflare Pages URL behavior (build-spec addendum 10):
//   - clean URLs serve pages:            /alpr      -> fetch /alpr.html
//   - .html forms 308 to the clean form: /alpr.html -> 308 /alpr
//   - trailing slashes stripped:         /alpr/     -> 308 /alpr
//   - /admin serves the Decap shell:     /admin     -> fetch /admin/index.html
//   - redirect map from the KeyValueStore (replaces static/_redirects)
//   - staging only: HTTP basic auth gate (BASIC_AUTH baked at synth; '' = off).
//     Static assets (/css, /assets, /media) are exempt: the admin's document
//     preview iframe loads them via <base href=PUBLIC_ORIGIN>, and a 401 on
//     any subresource pops a browser sign-in dialog. Pages stay gated.
// Unknown extensionless paths rewrite to <path>.html, miss S3, and land on the
// custom 404 response. Everything with a file extension passes through.
import cf from 'cloudfront';

const kvs = cf.kvs();

const BASIC_AUTH = '__BASIC_AUTH__';
const AUTH_EXEMPT_PREFIXES = ['/css/', '/assets/', '/media/'];

function authExempt(uri) {
  for (let i = 0; i < AUTH_EXEMPT_PREFIXES.length; i++) {
    if (uri.startsWith(AUTH_EXEMPT_PREFIXES[i])) return true;
  }
  return false;
}

function qs(request) {
  // Note: cloudfront-js-2.0 has no for...of — index loops only.
  const parts = [];
  for (const key in request.querystring) {
    const entry = request.querystring[key];
    if (entry.multiValue) {
      for (let i = 0; i < entry.multiValue.length; i++) {
        parts.push(key + '=' + entry.multiValue[i].value);
      }
    } else {
      parts.push(key + '=' + entry.value);
    }
  }
  return parts.length ? '?' + parts.join('&') : '';
}

var STATUS_TEXT = { 301: 'Moved Permanently', 302: 'Found', 307: 'Temporary Redirect', 308: 'Permanent Redirect' };
function redirect(to, status, request) {
  var q = qs(request);
  // Preserve the viewer's query string; a target that already carries one
  // gets it appended with '&', never a second '?'.
  var location = q ? (to.indexOf('?') === -1 ? to + q : to + '&' + q.slice(1)) : to;
  return {
    statusCode: status,
    statusDescription: STATUS_TEXT[status] || 'Found',
    headers: { location: { value: location } },
  };
}

async function handler(event) {
  const request = event.request;
  const uri = request.uri;

  if (BASIC_AUTH && !authExempt(uri)) {
    const auth = request.headers.authorization && request.headers.authorization.value;
    if (auth !== BASIC_AUTH) {
      return {
        statusCode: 401,
        statusDescription: 'Unauthorized',
        headers: { 'www-authenticate': { value: 'Basic realm="staging"' } },
      };
    }
  }

  // Redirect map — exact path match. Values are JSON: {"to": "...", "status": 302}
  try {
    const raw = await kvs.get(uri);
    if (raw) {
      const rule = JSON.parse(raw);
      return redirect(rule.to, rule.status || 302, request);
    }
  } catch (e) {
    // key not present — fall through
  }

  // Decap admin shell (retires in Phase 7)
  if (uri === '/admin') { request.uri = '/admin/index.html'; return request; }

  if (uri.endsWith('/index.html')) {
    const dir = uri.slice(0, uri.length - 'index.html'.length); // keeps trailing '/'
    return redirect(dir === '/' ? '/' : dir.slice(0, -1), 308, request);
  }
  if (uri.endsWith('.html')) {
    return redirect(uri.slice(0, -5), 308, request);
  }
  if (uri.length > 1 && uri.endsWith('/')) {
    return redirect(uri.slice(0, -1), 308, request);
  }

  if (uri === '/') { request.uri = '/index.html'; return request; }

  const lastSegment = uri.split('/').pop();
  if (!lastSegment.includes('.')) {
    request.uri = uri + '.html';
  }
  return request;
}
