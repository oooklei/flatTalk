export async function handleDebugApi(req, res, url, { logger, chatState, env, json }) {
  if (req.method === 'GET' && url.pathname === '/api/debug/status') {
    return json(res, 200, {
      ok: true,
      runtime_mode: env.runtimeMode || 'local',
      state_store: chatState.stateStore.source,
      running_count: chatState.running.size,
      log_path: logger.logPath,
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/debug/logs') {
    const limit = Number(url.searchParams.get('limit') || 200);
    return json(res, 200, { ok: true, items: logger.list({ limit }) });
  }

  if (req.method === 'POST' && url.pathname === '/api/debug/logs/clear') {
    logger.clear();
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { ok: false, error: 'debug_route_not_found' });
}
