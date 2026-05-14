// 简单静态文件服务器（仅依赖 Node.js 内置模块）
// 用法：node server.js  （默认端口 5173；通过环境变量 PORT 改）

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const os = require('os');

const ROOT = __dirname;
const PORT = parseInt(process.env.PORT || '5173', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt':  'text/plain; charset=utf-8',
  '.md':   'text/markdown; charset=utf-8'
};

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url);
  let pathname = decodeURIComponent(parsed.pathname);
  if (pathname === '/') pathname = '/index.html';
  let filePath = path.join(ROOT, pathname);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Service-Worker-Allowed': '/'
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const ifs = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(ifs)) {
    for (const ni of ifs[name]) {
      if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address);
    }
  }
  console.log('\n  张婷要省钱 - 本地预览\n');
  console.log(`  本机:    http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  局域网:  http://${ip}:${PORT}   ← 手机扫此地址`);
  console.log('\n  按 Ctrl+C 停止\n');
});
