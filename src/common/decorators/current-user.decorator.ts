import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthenticatedUser {
  sub: string;       // user id
  role: string;
  phone: string;
}

/** Extracts the authenticated user from the request (set by JwtStrategy). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.user;
  },
);
