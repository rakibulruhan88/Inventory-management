import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthUser } from '@afia/contracts';
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<{ user: AuthUser }>().user,
);
