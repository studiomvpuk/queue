import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { User } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface JwtPayload {
  sub: string;
  role: string;
  phone: string | null;
  email?: string | null;
}

export interface TokenPair {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresIn: number;
}

/**
 * TokenService — JWT access + opaque refresh token.
 *
 *  - Access tokens are short-lived (15m) JWTs signed with JWT_ACCESS_SECRET.
 *  - Refresh tokens are 64-byte random opaque tokens; only their argon2 hash
 *    is stored (in Session). Sent only to the client that generated them.
 *  - Refresh rotates on every use: old session is revoked, new one issued.
 *    Detection of replay (using a revoked token) triggers a full user
 *    session wipe as a defensive measure.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async issuePair(user: User, meta: { ip?: string; userAgent?: string }): Promise<TokenPair> {
    const accessTtl = Number(this.config.getOrThrow('JWT_ACCESS_TTL'));
    const refreshTtl = Number(this.config.getOrThrow('JWT_REFRESH_TTL'));
    const refreshSecret = this.config.getOrThrow<string>('JWT_REFRESH_SECRET');

    const payload: JwtPayload = { sub: user.id, role: user.role, phone: user.phone, email: user.email };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: accessTtl });

    // Refresh is a JWT too, but we also store its hash server-side so we can revoke.
    // This gives us both stateless verification and server-side revocation.
    const refreshId = randomBytes(16).toString('hex');
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, jti: refreshId },
      { secret: refreshSecret, expiresIn: refreshTtl },
    );
    const refreshHash = await argon2.hash(refreshToken, { type: argon2.argon2id });

    await this.prisma.session.create({
      data: {
        id: refreshId,
        userId: user.id,
        refreshHash,
        userAgent: meta.userAgent,
        ip: meta.ip,
        expiresAt: new Date(Date.now() + refreshTtl * 1000),
      },
    });

    return {
      accessToken,
      accessTokenExpiresIn: accessTtl,
      refreshToken,
      refreshTokenExpiresIn: refreshTtl,
    };
  }

  /**
   * Rotate refresh token. Returns a new token pair.
   * If the provided refresh token is expired or already revoked, we treat
   * it as a potential replay and revoke ALL sessions for the user.
   */
  async rotate(refreshToken: string, meta: { ip?: string; userAgent?: string }): Promise<TokenPair> {
    const refreshSecret = this.config.getOrThrow<string>('JWT_REFRESH_SECRET');

    let payload: { sub: string; jti: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, { secret: refreshSecret });
    } catch {
      throw new UnauthorizedException({ error: 'INVALID_REFRESH', message: 'Invalid refresh token' });
    }

    const session = await this.prisma.session.findUnique({ where: { id: payload.jti } });
    if (!session || session.userId !== payload.sub) {
      throw new UnauthorizedException({ error: 'INVALID_REFRESH', message: 'Invalid refresh token' });
    }

    if (session.revokedAt || session.expiresAt < new Date()) {
      // Replay or expired — defensive: revoke all sessions for this user
      await this.prisma.session.updateMany({
        where: { userId: payload.sub, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException({ error: 'SESSION_REVOKED', message: 'Session no longer valid' });
    }

    const matches = await argon2.verify(session.refreshHash, refreshToken);
    if (!matches) {
      // Token reuse from another source — nuclear option
      await this.prisma.session.updateMany({
        where: { userId: payload.sub, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException({ error: 'SESSION_REVOKED', message: 'Session no longer valid' });
    }

    const user = await this.prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) throw new UnauthorizedException({ error: 'USER_GONE', message: 'User no longer exists' });

    // Rotate: revoke old, issue new
    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    return this.issuePair(user, meta);
  }

  async revoke(refreshToken: string): Promise<void> {
    const refreshSecret = this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
    try {
      const payload = await this.jwt.verifyAsync<{ jti: string; sub: string }>(refreshToken, {
        secret: refreshSecret,
      });
      await this.prisma.session.updateMany({
        where: { id: payload.jti, userId: payload.sub, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } catch {
      // Best-effort — invalid token = nothing to revoke
    }
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
