import { UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from './auth.guard.js';

describe('account endpoint authentication', () => {
  it('rejects an unauthenticated request', async () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) };
    const request = { headers: {} };
    const context = {
      getHandler: vi.fn(),
      getClass: vi.fn(),
      switchToHttp: () => ({ getRequest: () => request }),
    };
    const guard = new AuthGuard(reflector as never, {} as never);
    await expect(guard.canActivate(context as never)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
