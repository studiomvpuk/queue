import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

/**
 * Allows either user JWT or client JWT.
 * Extracts auth info to req.user or req.client.
 */
@Injectable()
export class ApiClientAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }

    const token = authHeader.slice(7);

    try {
      const payload = this.jwt.verify(token, {
        secret: this.config.get('JWT_ACCESS_SECRET'),
      });

      if (payload.type === 'client') {
        request.client = {
          clientId: payload.sub,
          scopes: payload.scopes ?? [],
        };
      } else {
        // Regular user JWT
        request.user = {
          id: payload.sub,
          role: payload.role,
        };
      }

      return true;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}

/**
 * Decorator to check required scopes for client or user.
 * Usage: @RequireScopes('bookings:read', 'locations:read')
 */
export function RequireScopes(...scopes: string[]) {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (this: any, ...args: any[]) {
      const request = args[args.length - 1]?.switchToHttp?.()?.getRequest?.() ?? args[args.length - 1];

      if (request?.client) {
        const hasScopes = scopes.every((s) => request.client.scopes.includes(s));
        if (!hasScopes) {
          throw new UnauthorizedException('Insufficient scopes');
        }
      }

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}
