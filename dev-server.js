// run this for local 
// node dev-server.js

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 5500;
const rootDir = __dirname;

const server = http.createServer((req, res) => {
  // Strip query parameters from URL
  const parsedUrl = url.parse(req.url);
  const pathname = parsedUrl.pathname;
  let filePath = path.join(rootDir, pathname === '/' ? 'index.html' : pathname);

  // Set CORS headers for local development
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Try to serve the requested file
  fs.stat(filePath, (err, stats) => {
    if (!err && stats.isFile()) {
      // File exists, serve it
      return fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(500);
          res.end('Server Error');
          return;
        }

        const ext = path.extname(filePath);
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
          '.ico': 'image/x-icon',
          '.txt': 'text/plain; charset=utf-8',
          '.woff': 'font/woff',
          '.woff2': 'font/woff2',
          '.ttf': 'font/ttf'
        };

        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
        res.end(data);
      });
    }

    // File doesn't exist, try adding .html extension
    const htmlPath = filePath + '.html';
    fs.readFile(htmlPath, (err, data) => {
      if (!err) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      } else {
        res.writeHead(404);
        res.end('404 Not Found - File not found: ' + req.url);
      }
    });
  });
});

server.listen(PORT, () => {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║        TradingGrove Dev Server Running                    ║');
  console.log('╠════════════════════════════════════════════════════════╣');
  console.log(`║  🚀 URL: http://localhost:${PORT}                             ║`);
  console.log('║  ✅ Smart routing enabled (/auth → auth.html)          ║');
  console.log('║  ✅ CORS enabled for local API testing                 ║');
  console.log('║  📝 Press Ctrl+C to stop the server                    ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log('\n');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} is already in use!`);
    console.error('Options:');
    console.error(`  1. Close the application using port ${PORT}`);
    console.error(`  2. Or modify PORT in dev-server.js to use a different port`);
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});
