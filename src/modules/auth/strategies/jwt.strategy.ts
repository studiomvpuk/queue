import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { JwtPayload } from '../token.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService, private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    // Confirm the user still exists and isn't soft-deleted or banned
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, phone: true, deletedAt: true, bannedUntil: true },
    });
    if (!user || user.deletedAt) throw new UnauthorizedException({ error: 'USER_GONE' });
    if (user.bannedUntil && user.bannedUntil > new Date()) {
      throw new UnauthorizedException({ error: 'BANNED', message: 'Account temporarily suspended' });
    }
    return { sub: user.id, role: user.role, phone: user.phone, email: user.email };
  }
}
