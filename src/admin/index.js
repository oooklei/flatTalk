import fs from 'node:fs';
import path from 'node:path';
import { json, sendStatic } from './util.js';
import { handleModelsApi } from './models.js';
import { handleModuleApi } from './modules.js';
import { handleIntegrationsApi } from './integrations.js';
import { handleOpenApiAdmin } from './openapi.js';
import { handleAccessApi } from './access.js';
import { handleMapStudioApi } from './mapstudio.js';

const ADMIN_DIR = path.join(process.cwd(), 'src', 'public', 'admin');

// /api/admin/* → JSON 接口分发
export function handleAdminApi(req, res, url) {
  const sub = url.pathname.slice('/api/admin/'.length);
  const parts = sub.split('/').filter(Boolean);
  const method = req.method;
  if (parts[0] === 'models') {
    return handleModelsApi(req, res, url, parts.slice(1));
  }
  if (parts[0] === 'integrations') {
    return handleIntegrationsApi(req, res, method, parts.slice(1));
  }
  if (parts[0] === 'openapi') {
    return handleOpenApiAdmin(req, res, method, parts.slice(1));
  }
  if (parts[0] === 'access' || parts[0] === 'embeds') {
    return handleAccessApi(req, res, method, parts);
  }
  if (parts[0] === 'mapstudio') {
    return handleMapStudioApi(req, res, method, parts.slice(1));
  }
  return handleModuleApi(req, res, method, parts);
}

// /admin/* → 静态资源（SPA 回退到 index.html）
export function serveAdminStatic(req, res, url) {
  let p = url.pathname;
  if (p === '/admin' || p === '/admin/') p = '/admin/index.html';
  const rel = p.replace(/^\/admin\/?/, '');
  const filePath = path.join(ADMIN_DIR, rel || 'index.html');
  if (!filePath.startsWith(ADMIN_DIR)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return sendStatic(res, filePath);
  }
  const fallback = path.join(ADMIN_DIR, 'index.html');
  if (fs.existsSync(fallback)) return sendStatic(res, fallback);
  json(res, 404, { ok: false, error: 'admin_not_found' });
}
