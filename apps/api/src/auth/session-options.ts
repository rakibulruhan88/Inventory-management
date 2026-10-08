import type { ConfigService } from '@nestjs/config';
import type { CookieOptions } from 'express';

export const SESSION_COOKIE = 'afia_session';
// Browsers cap persistent cookies; renew this window on authenticated cookie requests.
export const SESSION_COOKIE_MAX_AGE = 400 * 24 * 60 * 60 * 1000;
export function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_COOKIE_MAX_AGE,
    path: '/',
  };
}
export function sessionJwtOptions(config: ConfigService) {
  // Device sessions have no application time limit. Logout clears the device cookie.
  return { secret: config.get<string>('JWT_SECRET', 'development-only-change-me') };
}
