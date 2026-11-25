import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';

/*
 * One line per request: time, method, path, status, duration, user and a request id.
 * LOG_FORMAT=json writes JSON lines (for log tools); otherwise a short readable line.
 * Every response carries the id in an X-Request-Id header, and server errors include it,
 * so a problem someone reports can be found in the log.
 */

const JSON_LOGS = process.env.LOG_FORMAT === 'json';
const ENABLED = process.env.NODE_ENV !== 'test';
// Polled by monitoring; logging each call would only add noise
const SKIP = new Set(['/api/health']);

export interface LoggedRequest extends Request {
  requestId?: string;
  user?: { id: string };
}

export function requestLogger(req: LoggedRequest, res: Response, next: NextFunction) {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && /^[\w-]{1,64}$/.test(incoming) ? incoming : randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);

  if (!ENABLED || SKIP.has(req.path)) return next();
  const started = process.hrtime.bigint();
  let logged = false;
  const log = () => {
    if (logged) return;
    logged = true;
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const entry = {
      time: new Date().toISOString(),
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      ms: Math.round(ms),
      user: req.user?.id,
      ip: req.ip,
      requestId: id,
    };
    if (JSON_LOGS) {
      console.log(JSON.stringify(entry));
    } else {
      const time = entry.time.slice(11, 19);
      console.log(`${time} ${entry.method} ${entry.path} ${entry.status} ${entry.ms}ms${entry.user ? ` ${entry.user}` : ''}`);
    }
  };
  // finish: response sent; close: client went away first (e.g. a live-updates stream ending)
  res.on('finish', log);
  res.on('close', log);
  next();
}

export function logServerError(err: unknown, req: LoggedRequest) {
  const message = err instanceof Error ? err.stack || err.message : String(err);
  if (JSON_LOGS) {
    console.error(JSON.stringify({ time: new Date().toISOString(), level: 'error', requestId: req.requestId, path: req.originalUrl, error: message }));
  } else {
    console.error(`Error in ${req.method} ${req.originalUrl} (request ${req.requestId}):\n${message}`);
  }
}
