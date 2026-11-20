/**
 * 面板 JSON 路由
 *
 * POST only，{ op, ...args } 入，{ ok, value } 或 { ok: false, error } 出。
 * 准入用宿主自身的 requestRejection 检查。
 */

export const API_PATH = '/query-scout/api';
const MAX_BODY_BYTES = 64 * 1024;

const STATUS_OF = {
  invalid: 400,
  unavailable: 503,
};

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

function fail(res, status, code, message) {
  sendJson(res, status, { ok: false, error: { code, message } });
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('request body is too large');
      error.code = 'invalid';
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function createOperations(service) {
  const sessionId = (a) => {
    if (typeof a.sessionId !== 'string' || a.sessionId === '') throw new service.ServiceError('invalid', 'sessionId is required');
    return a.sessionId;
  };
  return {
    state: (a) => service.state(sessionId(a)),
    update: (a) => service.update(sessionId(a), a.patch),
    reset: (a) => service.reset(sessionId(a)),
    // 会话 ID 可省略：带上时该会话改为跟随新的默认值
    saveDefaults: (a) => service.saveDefaults(typeof a.sessionId === 'string' && a.sessionId !== '' ? a.sessionId : undefined, a.patch),
  };
}

export function createApiHandler({ service, fence, logger = {} }) {
  const operations = createOperations(service);
  return async function handler(req, res) {
    if (!fence(req)) return fail(res, 403, 'forbidden', 'forbidden');
    if (req.method !== 'POST') {
      res.setHeader?.('allow', 'POST');
      return fail(res, 405, 'method', 'method not allowed');
    }
    const type = String(req.headers?.['content-type'] ?? '');
    if (!/^application\/json\b/i.test(type)) return fail(res, 415, 'content-type', 'content-type must be application/json');
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (error) {
      return fail(res, STATUS_OF[error?.code] ?? 400, error?.code ?? 'bad-json', String(error?.message ?? error));
    }
    if (body === null || typeof body !== 'object' || typeof body.op !== 'string') {
      return fail(res, 400, 'invalid', 'op is required');
    }
    const operation = Object.hasOwn(operations, body.op) ? operations[body.op] : undefined;
    if (!operation) return fail(res, 404, 'unknown-op', `unknown operation "${body.op}"`);
    try {
      await service.ready;
      const value = await operation(body);
      return sendJson(res, 200, { ok: true, value });
    } catch (error) {
      if (error && error.name === 'ServiceError') {
        return fail(res, STATUS_OF[error.code] ?? 400, error.code, error.message);
      }
      logger.warn?.(`query-scout: ${body.op} failed: ${error?.stack ?? error}`);
      return fail(res, 500, 'internal', String(error?.message ?? error));
    }
  };
}
