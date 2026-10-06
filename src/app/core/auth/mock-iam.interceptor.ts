import { HttpErrorResponse, HttpHeaders, HttpInterceptorFn, HttpRequest, HttpResponse } from '@angular/common/http';
import { Observable, delay, of, throwError } from 'rxjs';
import { APP_CONFIG } from '../config';
import { PlatformToken, Tenant } from './auth.models';
import { slugify } from '../../pages/auth/auth-shared';

/**
 * In-browser stand-in for the commons-iam-service endpoints the app uses, active while APP_CONFIG.mockApi is true.
 * Mirrors the real flows: new org (register → signup/tenant → PATCH tenantType) and join (register/user → activate →
 * user-verification not-reviewed). OTP is always "123456".
 * Demo: org "kaveri" (granter), user "meera@kaveri.org" / "Password@123" (admin). Join requests stay pending until
 * approved: run `localStorage.setItem('gm-mock-approve', '1')` in the console, then "Check again".
 */
const OTP = '123456';
interface MockUser { id: number; login: string; name: string; password: string; tenantLogin: string; admin: boolean }
const tenants: Tenant[] = [{ id: 1, tenantLogin: 'kaveri', tenantName: 'Kaveri Foundation', tenantType: APP_CONFIG.tenantTypes.granter }];
const users: MockUser[] = [{ id: 1, login: 'meera@kaveri.org', name: 'Meera Iyer', password: 'Password@123', tenantLogin: 'kaveri', admin: true }];
const pending = new Set<number>();
const sessions = new Map<string, number>(load());
const leads = new Map<string, any>();

export const mockIamInterceptor: HttpInterceptorFn = (req, next) => {
  if (!APP_CONFIG.mockApi || !req.url.startsWith(APP_CONFIG.iamBaseUrl)) return next(req);
  const path = req.url.slice(APP_CONFIG.iamBaseUrl.length);
  return route(req, path).pipe(delay(500));
};

function route(req: HttpRequest<any>, path: string): Observable<any> {
  const b = req.body ?? {};
  const me = users.find(u => u.id === sessions.get(req.headers.get(APP_CONFIG.sessionHeader) ?? ''));
  const p = (k: string) => req.params.get(k) ?? '';

  const activate = path.match(/^\/api\/v1\/signup\/user\/([^/]+)\/activate$/);
  if (req.method === 'POST' && activate) {
    const lead = leads.get(b.key);
    if (!lead) return fail(404, 'Signup request not found');
    if (b.otp !== OTP) return fail(401, 'Invalid or expired OTP');
    if (!tenants.some(t => t.tenantLogin === activate[1])) return fail(404, 'Tenant not found');
    const u = addUser(lead, req, activate[1], false);
    return session(u.id, { id: u.id, login: u.login }, 201);
  }

  switch (`${req.method} ${path}`) {
    case 'GET /api/v1/api-keys/session':
      return session(0, {});
    case 'POST /api/v1/security/login': {
      const u = users.find(x => x.login === b.userLogin && x.tenantLogin === b.tenantLogin);
      return u && u.password === b.password ? session(u.id, null) : fail(401, 'Invalid credentials');
    }
    case 'POST /api/v1/security/logout':
      sessions.delete(req.headers.get(APP_CONFIG.sessionHeader) ?? '');
      save();
      return ok(null);
    case 'GET /api/v1/session/context': {
      if (!me) return fail(401, 'Session expired');
      const t = tenants.find(x => x.tenantLogin === me.tenantLogin)!;
      const token: PlatformToken = {
        tenantContext: { tenantId: t.id, tenantLogin: t.tenantLogin, tenantName: t.tenantName },
        userContext: { userId: me.id, username: me.login, name: me.name, authorities: me.admin ? [`role.${t.tenantLogin}.admin`] : [] },
      };
      return ok(token);
    }
    case 'GET /api/v1/tenants/me':
      return me ? ok(tenants.find(x => x.tenantLogin === me.tenantLogin)) : fail(401, 'Session expired');
    case 'GET /api/v1/tenants/login': {
      const t = tenants.find(x => x.tenantLogin === p('loginName'));
      return t ? ok(t) : fail(404, 'Tenant not found');
    }
    case 'PATCH /api/v1/tenants': {
      const t = tenants.find(x => x.id === b.id);
      if (!me?.admin || !t || t.tenantLogin !== me.tenantLogin) return fail(403, 'Forbidden');
      t.tenantType = b.tenantType;
      return ok(null);
    }
    case 'GET /api/v1/signup/exists': {
      const found = users.filter(u => u.login === p('email'))
        .map(u => tenants.find(t => t.tenantLogin === u.tenantLogin)!)
        .map(t => ({ id: t.id, login: t.tenantLogin, name: t.tenantName }));
      return ok({ tenants: found, tenantPresent: found.length > 0, leadPresent: false });
    }
    case 'PATCH /api/v1/security/forget':
      return ok(crypto.randomUUID());
    case 'PATCH /api/v1/security/reset': {
      if (b.otp !== OTP) return fail(401, 'Invalid or expired OTP');
      const u = users.find(x => x.login === b.userLogin && x.tenantLogin === b.tenantLogin);
      if (u) u.password = b.password;
      return ok(null);
    }
    case 'POST /api/v1/signup/register':
    case 'POST /api/v1/signup/register/user': {
      const key = crypto.randomUUID();
      leads.set(key, b);
      return ok({ key, messageId: crypto.randomUUID() });
    }
    case 'PATCH /api/v1/lead/otp/re-send':
      return ok({ key: p('key') });
    case 'POST /api/v1/signup/tenant/markify2': {
      const lead = leads.get(b.key);
      if (!lead) return fail(404, 'Signup request not found');
      if (b.otp !== OTP) return fail(401, 'Invalid or expired OTP');
      const login = slugify(String(lead.organizationName));
      if (tenants.some(t => t.tenantLogin === login)) return fail(409, 'Organisation ID is taken');
      const t: Tenant = { id: tenants.length + 1, tenantLogin: login, tenantName: lead.organizationName, tenantType: 'BSP' };
      tenants.push(t);
      const u = addUser(lead, req, login, true);
      return session(u.id, t, 201);
    }
    case 'POST /api/v1/user-verification/not-reviewed':
      pending.add(+p('userId'));
      return ok({ id: +p('userId'), userId: +p('userId'), verificationStatus: 'NOT_REVIEWED' });
    case 'GET /api/v1/user-verification': {
      const id = +p('userId');
      if (!pending.has(id)) return fail(404, 'Not found');
      if (localStorage.getItem('gm-mock-approve')) { pending.delete(id); return ok({ id, userId: id, verificationStatus: 'APPROVED' }); }
      return ok({ id, userId: id, verificationStatus: 'NOT_REVIEWED' });
    }
  }
  return fail(404, 'Not mocked');
}

function addUser(lead: any, req: HttpRequest<any>, tenantLogin: string, admin: boolean): MockUser {
  const u: MockUser = {
    id: users.length + 1, login: lead.email, name: lead.leadContactPersonName,
    password: req.headers.get('X-PASS') ?? '', tenantLogin, admin,
  };
  users.push(u);
  leads.delete(req.body.key);
  return u;
}

function session(userId: number, body: unknown, status = 200) {
  const id = crypto.randomUUID();
  sessions.set(id, userId);
  save();
  return of(new HttpResponse({ status, body, headers: new HttpHeaders({ [APP_CONFIG.sessionHeader]: id }) }));
}
const ok = (body: unknown) => of(new HttpResponse({ status: 200, body }));
const fail = (status: number, message: string) =>
  throwError(() => new HttpErrorResponse({ status, error: { message } })).pipe(delay(500));

// Persist mock sessions so a page reload keeps you signed in (users created this page-load are not persisted).
function load(): [string, number][] {
  try { return JSON.parse(localStorage.getItem('gm-mock-sessions-v3') ?? '[]'); } catch { return []; }
}
function save() {
  try { localStorage.setItem('gm-mock-sessions-v3', JSON.stringify([...sessions])); } catch {}
}
