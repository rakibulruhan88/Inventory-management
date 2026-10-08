import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import type { AuthUser } from '@afia/contracts';
import { AuthGuard } from './auth.guard.js';
import { AuthController } from './auth.controller.js';
import { SESSION_COOKIE, SESSION_COOKIE_MAX_AGE, sessionCookieOptions, sessionJwtOptions } from './session-options.js';

const user: AuthUser = { id: 'owner', name: 'Owner', username: 'owner', email: null, role: 'OWNER' };
const config = { get: () => 'session-test-secret' };
const jwt = new JwtService(sessionJwtOptions(config as never));
function requestContext(headers: Record<string, string>, response = { cookie: vi.fn() }) {
  const request: { headers: Record<string, string>; user?: AuthUser } = { headers };
  const context = {
    getHandler: () => ({}), getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  };
  return { context, request, response };
}
const guard = () => new AuthGuard({ getAllAndOverride: () => false } as never, jwt);
afterEach(() => vi.unstubAllEnvs());

describe('persistent device login', () => {
  it('has no JWT time limit, even years after login', async () => {
    const token = await jwt.signAsync(user);
    expect(jwt.decode(token)).not.toHaveProperty('exp');
    await expect(jwt.verifyAsync(token, { clockTimestamp: Math.floor(Date.now() / 1000) + 20 * 365 * 86400 })).resolves.toMatchObject(user);
  });
  it('uses a persistent HttpOnly cookie and keeps production HTTPS protection', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(sessionCookieOptions()).toEqual({ httpOnly: true, sameSite: 'lax', secure: true, maxAge: 400 * 86400000, path: '/' });
    vi.stubEnv('NODE_ENV', 'development');
    expect(sessionCookieOptions().secure).toBe(false);
  });
  it('renews the cookie window on authenticated requests without replacing a persistent token', async () => {
    const token = await jwt.signAsync(user);
    const { context, request, response } = requestContext({ cookie: `other=value; ${SESSION_COOKIE}=${token}` });
    await expect(guard().canActivate(context as never)).resolves.toBe(true);
    expect(request.user).toMatchObject(user);
    expect(response.cookie).toHaveBeenCalledWith(SESSION_COOKIE, token, expect.objectContaining({ maxAge: SESSION_COOKIE_MAX_AGE, httpOnly: true }));
  });
  it('upgrades an unexpired seven-day cookie to a persistent login', async () => {
    const oldToken = await jwt.signAsync(user, { expiresIn: '7d' });
    const { context, response } = requestContext({ cookie: `${SESSION_COOKIE}=${oldToken}` });
    await guard().canActivate(context as never);
    const upgraded = response.cookie.mock.calls[0][1] as string;
    expect(upgraded).not.toBe(oldToken);
    expect(jwt.decode(upgraded)).not.toHaveProperty('exp');
    await expect(jwt.verifyAsync(upgraded)).resolves.toMatchObject(user);
  });
  it.each(['tampered-token', 'expired'])('does not renew or accept an invalid login: %s', async (kind) => {
    const token = kind === 'expired' ? await jwt.signAsync(user, { expiresIn: -1 }) : kind;
    const { context, response } = requestContext({ cookie: `${SESSION_COOKIE}=${token}` });
    await expect(guard().canActivate(context as never)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(response.cookie).not.toHaveBeenCalled();
  });
  it('preserves bearer authentication without creating a browser cookie', async () => {
    const token = await jwt.signAsync(user);
    const { context, response } = requestContext({ authorization: `Bearer ${token}` });
    await expect(guard().canActivate(context as never)).resolves.toBe(true);
    expect(response.cookie).not.toHaveBeenCalled();
  });
  it('issues the persistent cookie at login and clears it at logout', async () => {
    const token = await jwt.signAsync(user);
    const controller = new AuthController({ recordSignOut: vi.fn().mockResolvedValue(undefined), login: vi.fn().mockResolvedValue({ user, token }) } as never);
    const response = { cookie: vi.fn(), clearCookie: vi.fn() };
    await expect(controller.login({ identifier: 'owner', password: 'valid-password' }, response as never)).resolves.toEqual({ user });
    expect(response.cookie).toHaveBeenCalledWith(SESSION_COOKIE, token, sessionCookieOptions());
    await expect(controller.logout(response as never, user)).resolves.toEqual({ signedOut: true });
    expect(response.clearCookie).toHaveBeenCalledWith(SESSION_COOKIE, { path: '/' });
    const { context } = requestContext({});
    await expect(guard().canActivate(context as never)).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('still clears the current device login after a password change', async () => {
    const controller = new AuthController({ changePassword: vi.fn().mockResolvedValue({ passwordChanged: true }) } as never);
    const response = { clearCookie: vi.fn() };
    await controller.changePassword(user, { currentPassword: 'old-password', newPassword: 'new-password' }, response as never);
    expect(response.clearCookie).toHaveBeenCalledWith(SESSION_COOKIE, { path: '/' });
  });
});
