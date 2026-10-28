import { Router, type Request, type RequestHandler, type Response } from 'express';
import type { AccountUser } from '@team-plan/shared';
import type { AppConfig } from '../../config';
import type { AccountService } from '../../modules/accounts/service';
import { csrfFor, sameSecret } from '../../modules/accounts/security';
import { AppError } from '../errors';
import { writeRoute } from '../middleware/json-body';
import { assertAllowedKeys, parseQuery } from '../validation';

const COOKIE = 'tb_session';
export function sessionToken(req: Request): string {
  const cookies = String(req.headers.cookie ?? '').split(';').map((part) => part.trim());
  const values = cookies.filter((part) => part.startsWith(`${COOKIE}=`));
  return values.length === 1 ? values[0]!.slice(COOKIE.length + 1) : '';
}

export function currentUser(res: Response): AccountUser {
  const user = res.locals.user as AccountUser | undefined;
  if (!user) throw new AppError(401, 'UNAUTHENTICATED');
  return user;
}

function sameOrigin(req: Request): void {
  if (req.get('Sec-Fetch-Site') === 'cross-site') throw new AppError(403, 'CSRF_INVALID');
  const origin = req.get('Origin');
  if (origin !== undefined && origin !== `${req.protocol}://${req.get('host')}`) {
    throw new AppError(403, 'CSRF_INVALID');
  }
}

export function requireSession(service: AccountService): RequestHandler {
  return (req, res, next) => {
    const token = sessionToken(req);
    const user = service.find(token);
    if (!user) throw new AppError(401, 'UNAUTHENTICATED');
    res.locals.user = user;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      sameOrigin(req);
      if (!sameSecret(req.get('X-CSRF-Token') ?? '', csrfFor(token))) throw new AppError(403, 'CSRF_INVALID');
    }
    next();
  };
}

function text(value: unknown, field: string, min: number, max: number, trim = true): string {
  const result = typeof value === 'string' ? (trim ? value.trim() : value) : '';
  if (Array.from(result).length < min || Array.from(result).length > max) {
    throw new AppError(422, 'VALIDATION_ERROR', { fields: { [field]: `请填写 ${min}～${max} 个字符` } });
  }
  return result;
}

export function accountsRouter(service: AccountService, config: AppConfig): Router {
  const router = Router();
  router.use('/auth', (req, _res, next) => { parseQuery(req.query as Record<string, unknown>, []); next(); });
  function cookie(req: Request, res: Response, token: string): void {
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(req.hostname);
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: req.secure || (config.env === 'production' && !loopback), path: '/', maxAge: 7 * 86400000 });
  }
  function signIn(req: Request, res: Response, user: AccountUser): void {
    service.revoke(sessionToken(req));
    const token = service.issue(user.id);
    cookie(req, res, token);
    res.json({ data: { user, csrfToken: csrfFor(token) } });
  }

  router.get('/auth/me', (req, res) => {
    parseQuery(req.query as Record<string, unknown>, []);
    const token = sessionToken(req);
    const user = service.find(token);
    res.json({ data: { user, csrfToken: user ? csrfFor(token) : null } });
  });
  for (const mode of ['register', 'login'] as const) {
    router.post(`/auth/${mode}`, ...writeRoute(async (req, res) => {
      sameOrigin(req);
      parseQuery(req.query as Record<string, unknown>, []);
      assertAllowedKeys(req.body, mode === 'register' ? ['username', 'displayName', 'password'] : ['username', 'password']);
      const username = text(req.body.username, 'username', 3, 32).toLowerCase();
      if (!/^[a-z0-9_]+$/.test(username)) throw new AppError(422, 'VALIDATION_ERROR', { fields: { username: '用户名仅支持字母、数字和下划线' } });
      const password = text(req.body.password, 'password', mode === 'register' ? 12 : 1, 128, false);
      service.throttle(`${mode}:ip:${req.ip}`, mode === 'register' ? 10 : 60, 15 * 60000);
      if (mode === 'login') service.throttle(`login:user:${username}`, 10, 15 * 60000);
      const user = mode === 'register'
        ? await service.register(username, text(req.body.displayName, 'displayName', 1, 30), password)
        : await service.login(username, password);
      res.status(mode === 'register' ? 201 : 200);
      signIn(req, res, user);
    }));
  }
  router.post('/auth/logout', requireSession(service), ...writeRoute((req, res) => {
    assertAllowedKeys(req.body, []);
    service.revoke(sessionToken(req));
    cookie(req, res, '');
    res.clearCookie(COOKIE, { path: '/', httpOnly: true, sameSite: 'strict', secure: req.secure || (config.env === 'production' && !['localhost', '127.0.0.1', '[::1]'].includes(req.hostname)) });
    res.status(204).end();
  }));
  router.put('/auth/profile', requireSession(service), ...writeRoute((req, res) => {
    assertAllowedKeys(req.body, ['displayName']);
    res.json({ data: service.profile(currentUser(res).id, text(req.body.displayName, 'displayName', 1, 30)) });
  }));
  router.put('/auth/password', requireSession(service), ...writeRoute(async (req, res) => {
    assertAllowedKeys(req.body, ['currentPassword', 'newPassword']);
    service.throttle(`password:${currentUser(res).id}`, 10, 15 * 60000);
    await service.password(currentUser(res).id, text(req.body.currentPassword, 'currentPassword', 1, 128, false), text(req.body.newPassword, 'newPassword', 12, 128, false));
    signIn(req, res, currentUser(res));
  }));
  return router;
}
