// run this for local
// node dev-server.js

const http = require('http');
const fs = require('fs');
const path = require('path');

const PREFERRED_PORT = 5500;
const rootDir = __dirname;

// Load Vercel rewrites so local dev mirrors production routing.
// vercel.json contains entries like { source: "/dashboard", destination: "/src/pages/dashboard.html" }.
let rewrites = [];
try {
  const vercelCfg = JSON.parse(fs.readFileSync(path.join(rootDir, 'vercel.json'), 'utf8'));
  rewrites = Array.isArray(vercelCfg.rewrites) ? vercelCfg.rewrites : [];
} catch (e) {
  console.warn('Could not load vercel.json rewrites:', e.message);
}

function applyRewrite(pathname) {
  const match = rewrites.find(r => r.source === pathname);
  return match ? match.destination : null;
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

function serveFile(filePath, res, statusCode = 200) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      console.error('[500]', filePath, err.code);
      res.writeHead(500);
      res.end('Server Error: ' + err.code + ' — ' + filePath);
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(statusCode, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    res.end(data);
  });
}

function serve404(res) {
  const notFoundPath = path.join(rootDir, 'src', '404.html');
  fs.stat(notFoundPath, (err) => {
    if (!err) {
      return serveFile(notFoundPath, res, 404);
    }
    // Fallback if 404.html doesn't exist
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>404 - Page Not Found</h1>');
  });
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;

  // CORS for local API testing
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // 1) Vercel rewrite match (clean URLs like /dashboard → /src/pages/dashboard.html)
  const rewritten = applyRewrite(pathname);
  if (rewritten) {
    return serveFile(path.join(rootDir, 'src', rewritten), res);
  }

  // 2) Direct file serve (for assets like /src/assets/...)
  const directPath = path.join(rootDir, pathname);
  fs.stat(directPath, (err, stats) => {
    if (!err && stats.isFile()) {
      return serveFile(directPath, res);
    }

    // 2b) Also try src/ for assets that live under src/
    const srcPath = path.join(rootDir, 'src', pathname);
    fs.stat(srcPath, (errSrc, statsSrc) => {
      if (!errSrc && statsSrc.isFile()) {
        return serveFile(srcPath, res);
      }

      // 3) Try with .html extension at root (only if pathname doesn't already end with .html)
      if (!pathname.endsWith('.html')) {
        const htmlPath = directPath + '.html';
        fs.stat(htmlPath, (err2, stats2) => {
          if (!err2 && stats2.isFile()) {
            return serveFile(htmlPath, res);
          }
          tryPagesPath();
        });
      } else {
        tryPagesPath();
      }
    });

    function tryPagesPath() {
      // 4) Try src/{path} or src/{path without .html}.html as fallback
      let pagesPath = path.join(rootDir, 'src', pathname.replace(/^\//, ''));

      // If pathname ends with .html, try it as-is first, then without extension
      if (pathname.endsWith('.html')) {
        fs.stat(pagesPath, (err3, stats3) => {
          if (!err3 && stats3.isFile()) {
            return serveFile(pagesPath, res);
          }
          // Try without .html extension
          pagesPath = pagesPath.slice(0, -5); // remove .html
          fs.stat(pagesPath, (err4, stats4) => {
            if (!err4 && stats4.isFile()) {
              return serveFile(pagesPath, res);
            }
            serve404(res);
          });
        });
      } else {
        // pathname doesn't end with .html, add it
        pagesPath = pagesPath + '.html';
        fs.stat(pagesPath, (err3, stats3) => {
          if (!err3 && stats3.isFile()) {
            return serveFile(pagesPath, res);
          }
          serve404(res);
        });
      }
    }
  });
});

function findFreePort(port, cb) {
  const probe = http.createServer();
  probe.listen(port, () => { probe.close(() => cb(port)); });
  probe.on('error', () => findFreePort(port + 1, cb));
}

findFreePort(PREFERRED_PORT, (port) => {
  if (port !== PREFERRED_PORT) {
    console.log(`\n⚠️  Port ${PREFERRED_PORT} is in use — using port ${port} instead.`);
  }

  server.listen(port, () => {
    const serverUrl = `http://localhost:${port}`;
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║        TradingGrove Dev Server Running                 ║');
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log(`║  🚀 URL: ${serverUrl.padEnd(46)}║`);
    console.log(`║  ✅ Vercel rewrites loaded: ${String(rewrites.length).padEnd(28)}║`);
    console.log('║  ✅ CORS enabled for local API testing                 ║');
    console.log('║  📝 Press Ctrl+C to stop the server                    ║');
    console.log('╚════════════════════════════════════════════════════════╝');
    console.log('\n');
  });

  server.on('error', (err) => {
    console.error('Server error:', err);
    process.exit(1);
  });
});
