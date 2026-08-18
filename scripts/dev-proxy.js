const http = require('http');
const url = require('url');

const PORT = 8080;
const TIMEOUT_MS = 5000;
// 重操作（搜索 / 人声分离 / 下载）会阻塞数秒到数十秒：代理侧给足超时，否则会提前断开
// 下游（表现为 "连接失败: UNKNOWN"）。默认 5s 仍用于 admin/h5/websocket 等轻请求。
const SERVICE_TIMEOUTS = {
  backend: 90000,
  separator: 90000,
  downloader: 90000,
};

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
};

const METHOD_COLORS = {
  GET: COLORS.green,
  POST: COLORS.yellow,
  PUT: COLORS.blue,
  DELETE: COLORS.red,
  PATCH: COLORS.cyan,
};

const getStatusColor = (statusCode) => {
  if (statusCode >= 200 && statusCode < 300) return COLORS.green;
  if (statusCode >= 300 && statusCode < 400) return COLORS.blue;
  if (statusCode >= 400 && statusCode < 500) return COLORS.yellow;
  return COLORS.red;
};

const log = (method, reqPath, target, statusCode, error) => {
  const methodColor = METHOD_COLORS[method] || COLORS.gray;
  const timestamp = new Date().toLocaleTimeString();

  if (error) {
    console.log(
      `${COLORS.gray}[${timestamp}]${COLORS.reset} ${methodColor}${method}${COLORS.reset} ${reqPath} → ${COLORS.red}ERROR: ${error}${COLORS.reset}`
    );
    return;
  }

  const statusColor = getStatusColor(statusCode);
  console.log(
    `${COLORS.gray}[${timestamp}]${COLORS.reset} ${methodColor}${method}${COLORS.reset} ${reqPath} → ${COLORS.cyan}${target}${COLORS.reset} ${statusColor}${statusCode}${COLORS.reset}`
  );
};

const getTarget = (pathname) => {
  if (pathname === '/') {
    return { type: 'redirect', location: '/admin/' };
  }

  if (pathname === '/admin' || pathname === '/h5') {
    return { type: 'redirect', location: pathname + '/' };
  }

  if (pathname.startsWith('/admin/')) {
    return { type: 'proxy', target: `http://localhost:5173${pathname}`, service: 'admin-web' };
  }

  if (pathname.startsWith('/h5/')) {
    return { type: 'proxy', target: `http://localhost:5174${pathname}`, service: 'mobile-h5' };
  }

  if (pathname.startsWith('/api/')) {
    return { type: 'proxy', target: `http://localhost:3000${pathname}`, service: 'backend' };
  }

  if (pathname === '/ws' || pathname.startsWith('/ws/')) {
    return { type: 'ws', target: `ws://localhost:3000${pathname}`, service: 'backend' };
  }

  if (pathname.startsWith('/separator/')) {
    const stripped = pathname.replace(/^\/separator/, '');
    return { type: 'proxy', target: `http://localhost:8001${stripped || '/'}`, service: 'separator' };
  }

  if (pathname.startsWith('/downloader/')) {
    const stripped = pathname.replace(/^\/downloader/, '');
    return { type: 'proxy', target: `http://localhost:8002${stripped || '/'}`, service: 'downloader' };
  }

  return { type: 'notfound' };
};

const sendErrorPage = (res, statusCode, title, detail) => {
  const body = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>${statusCode} ${title}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
         background:#f8f9fa; color:#333; display:flex; align-items:center;
         justify-content:center; min-height:100vh; }
  .card { background:#fff; border-radius:12px; padding:2.5rem 3rem;
          max-width:520px; box-shadow:0 4px 24px rgba(0,0,0,.08); }
  h1 { font-size:1.5rem; margin-bottom:.5rem; color:#e74c3c; }
  code { background:#f1f3f5; padding:.15rem .4rem; border-radius:4px; font-size:.85rem; }
  .hint { margin-top:1rem; padding:1rem; background:#fff3cd; border-radius:8px;
           font-size:.9rem; line-height:1.6; }
  .hint code { background:#ffeeba; }
</style></head>
<body><div class="card">
<h1>${statusCode} ${title}</h1>
<p>${detail}</p>
</div></body></html>`;
  res.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
};

const proxyRequest = (req, res, targetUrl, service) => {
  const parsedTarget = url.parse(targetUrl);
  const search = url.parse(req.url).search || '';
  const timeoutMs = SERVICE_TIMEOUTS[service] || TIMEOUT_MS;

  const options = {
    hostname: parsedTarget.hostname,
    port: parsedTarget.port,
    path: parsedTarget.path + search,
    method: req.method,
    headers: { ...req.headers, host: `${parsedTarget.hostname}:${parsedTarget.port}` },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    const sc = proxyRes.statusCode || 0;
    log(req.method, req.url, targetUrl, sc);
    try {
      res.writeHead(sc, proxyRes.headers);
      proxyRes.pipe(res);
    } catch {
      res.destroy();
    }
  });

  proxyReq.setTimeout(timeoutMs, () => {
    // 显式带上 code，否则 error handler 会落到 "连接失败: UNKNOWN" 分支，误导排查。
    proxyReq.destroy(Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' }));
  });

  proxyReq.on('error', (err) => {
    const code = err.code || 'UNKNOWN';
    const friendly =
      code === 'ECONNREFUSED'
        ? `${service} 未启动 (${parsedTarget.hostname}:${parsedTarget.port})`
        : code === 'ETIMEDOUT'
          ? `连接 ${service} 超时 (${timeoutMs / 1000}s)`
          : `${service} 连接失败: ${code}`;

    log(req.method, req.url, targetUrl, null, friendly);

    if (!res.headersSent) {
      sendErrorPage(res, 502, '服务不可用', friendly);
    } else {
      res.end();
    }
  });

  req.on('error', () => proxyReq.destroy());
  req.pipe(proxyReq);
};

const handleUpgrade = (req, socket, head, targetUrl, service) => {
  const parsedTarget = url.parse(targetUrl);
  const search = url.parse(req.url).search || '';

  const options = {
    hostname: parsedTarget.hostname,
    port: parsedTarget.port,
    path: parsedTarget.path + search,
    method: 'GET',
    headers: { ...req.headers, host: `${parsedTarget.hostname}:${parsedTarget.port}` },
  };

  const proxyReq = http.request(options);

  proxyReq.setTimeout(TIMEOUT_MS, () => {
    proxyReq.destroy(new Error('ETIMEDOUT'));
  });

  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    log('WS', req.url, targetUrl, proxyRes.statusCode || 101);

    const statusLine = `HTTP/1.1 101 Switching Protocols\r\n`;
    const headers = Object.entries(proxyRes.headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n');
    socket.write(statusLine + headers + '\r\n\r\n');

    if (proxyHead.length > 0) socket.write(proxyHead);

    proxySocket.pipe(socket);
    socket.pipe(proxySocket);

    proxySocket.on('error', () => socket.destroy());
    socket.on('error', () => proxySocket.destroy());
  });

  proxyReq.on('error', (err) => {
    const code = err.code || 'UNKNOWN';
    const msg = code === 'ECONNREFUSED' ? `${service} 未启动` : `连接失败: ${code}`;
    log('WS', req.url, targetUrl, null, msg);
    socket.write(
      `HTTP/1.1 502 Bad Gateway\r\nContent-Type: application/json\r\n\r\n` +
        JSON.stringify({ error: 'Bad Gateway', message: msg })
    );
    socket.destroy();
  });

  socket.on('error', () => proxyReq.destroy());
  proxyReq.end();
};

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url);
  const pathname = parsedUrl.pathname;

  const route = getTarget(pathname);

  switch (route.type) {
    case 'redirect':
      log(req.method, req.url, route.location, 302);
      res.writeHead(302, { Location: route.location });
      res.end();
      break;

    case 'proxy':
      proxyRequest(req, res, route.target, route.service);
      break;

    case 'notfound':
      log(req.method, req.url, 'N/A', 404);
      sendErrorPage(res, 404, 'Not Found', `路径 <code>${pathname}</code> 不存在`);
      break;
  }
});

server.on('upgrade', (req, socket, head) => {
  const parsedUrl = url.parse(req.url);
  const pathname = parsedUrl.pathname;

  const route = getTarget(pathname);

  if (route.type === 'ws') {
    handleUpgrade(req, socket, head, route.target, route.service);
  } else {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`${COLORS.green}${COLORS.bold}Dev Proxy${COLORS.reset} ${COLORS.green}running at http://localhost:${PORT}${COLORS.reset}\n`);
  console.log(`${COLORS.gray}Routes:${COLORS.reset}`);
  console.log(`  ${COLORS.cyan}/${COLORS.reset}              → ${COLORS.yellow}/admin/${COLORS.reset} (302 redirect)`);
  console.log(`  ${COLORS.cyan}/admin/*${COLORS.reset}       → ${COLORS.yellow}http://localhost:5173${COLORS.reset}  (admin-web)`);
  console.log(`  ${COLORS.cyan}/h5/*${COLORS.reset}           → ${COLORS.yellow}http://localhost:5174${COLORS.reset}  (mobile-h5)`);
  console.log(`  ${COLORS.cyan}/api/*${COLORS.reset}          → ${COLORS.yellow}http://localhost:3000${COLORS.reset}   (backend)`);
  console.log(`  ${COLORS.cyan}/ws${COLORS.reset}              → ${COLORS.yellow}ws://localhost:3000/ws${COLORS.reset}  (WebSocket)`);
  console.log(`  ${COLORS.cyan}/ws/*${COLORS.reset}            → ${COLORS.yellow}ws://localhost:3000/ws/*${COLORS.reset} (WebSocket)`);
  console.log(`  ${COLORS.cyan}/separator/*${COLORS.reset}     → ${COLORS.yellow}http://localhost:8001${COLORS.reset}  (separator)`);
  console.log(`  ${COLORS.cyan}/downloader/*${COLORS.reset}    → ${COLORS.yellow}http://localhost:8002${COLORS.reset}  (downloader)\n`);

  console.log(`${COLORS.gray}Target services:${COLORS.reset}`);
  const targets = [
    ['admin-web', 5173],
    ['mobile-h5', 5174],
    ['backend', 3000],
    ['separator', 8001],
    ['downloader', 8002],
  ];
  for (const [name, port] of targets) {
    const check = http.get(`http://localhost:${port}`, { timeout: 1000 }, (r) => {
      console.log(`  ${COLORS.green}✓${COLORS.reset} ${name} (:${port}) ${COLORS.green}running${COLORS.reset}`);
      r.resume();
    });
    check.on('error', () => {
      console.log(`  ${COLORS.red}✗${COLORS.reset} ${name} (:${port}) ${COLORS.red}not running${COLORS.reset}`);
    });
    check.on('timeout', () => {
      check.destroy();
      console.log(`  ${COLORS.yellow}?${COLORS.reset} ${name} (:${port}) ${COLORS.yellow}timeout${COLORS.reset}`);
    });
  }
  console.log(`\n${COLORS.gray}Tip: use ${COLORS.bold}pnpm dev${COLORS.reset}${COLORS.gray} to start all services + proxy${COLORS.reset}\n`);
});
