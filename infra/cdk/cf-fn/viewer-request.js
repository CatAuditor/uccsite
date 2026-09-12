// CloudFront Function (viewer-request, runtime 2.0).
// Reproduces the live Cloudflare Pages URL behavior (build-spec addendum 10):
//   - clean URLs serve pages:            /alpr      -> fetch /alpr.html
//   - .html forms 308 to the clean form: /alpr.html -> 308 /alpr
//   - trailing slashes stripped:         /alpr/     -> 308 /alpr
//   - /admin serves the Decap shell:     /admin     -> fetch /admin/index.html
//   - redirect map from the KeyValueStore (replaces static/_redirects)
//   - staging only: HTTP basic auth gate (BASIC_AUTH baked at synth; '' = off)
// Unknown extensionless paths rewrite to <path>.html, miss S3, and land on the
// custom 404 response. Everything with a file extension passes through.
import cf from 'cloudfront';

const kvs = cf.kvs();

const BASIC_AUTH = '__BASIC_AUTH__';

function qs(request) {
  const parts = [];
  for (const key in request.querystring) {
    const entry = request.querystring[key];
    if (entry.multiValue) {
      for (const item of entry.multiValue) parts.push(key + '=' + item.value);
    } else {
      parts.push(key + '=' + entry.value);
    }
  }
  return parts.length ? '?' + parts.join('&') : '';
}

function redirect(to, status, request) {
  return {
    statusCode: status,
    statusDescription: status === 308 ? 'Permanent Redirect' : 'Found',
    headers: { location: { value: to + qs(request) } },
  };
}

async function handler(event) {
  const request = event.request;
  const uri = request.uri;

  if (BASIC_AUTH) {
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
