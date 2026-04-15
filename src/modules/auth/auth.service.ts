import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditAction, User, UserRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { OtpService } from './otp.service';
import { TokenService, TokenPair } from './token.service';

interface AuthMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  async requestOtp(phone: string, meta: AuthMeta): Promise<{ expiresAt: Date }> {
    const result = await this.otp.issue(phone, meta.ip, meta.userAgent);
    await this.audit.record({
      action: AuditAction.OTP_REQUESTED,
      entity: 'OtpRequest',
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: { phone: phone.slice(-4) }, // last 4 only — no PII
    });
    return result;
  }

  /**
   * Verify OTP and log the user in. If no account exists, creates one
   * (requires firstName on first-time sign-up).
   */
  async verifyOtp(
    phone: string,
    code: string,
    firstName: string | undefined,
    meta: AuthMeta,
  ): Promise<{ user: Pick<User, 'id' | 'phone' | 'firstName' | 'role'>; tokens: TokenPair; isNewUser: boolean }> {
    const { phone: normalised } = await this.otp.verify(phone, code);

    let user = await this.prisma.user.findUnique({ where: { phone: normalised } });
    let isNewUser = false;

    if (!user) {
      if (!firstName?.trim()) {
        throw new BadRequestException({
          error: 'FIRST_NAME_REQUIRED',
          message: 'First name is required for sign-up',
        });
      }
      user = await this.prisma.user.create({
        data: {
          phone: normalised,
          firstName: firstName.trim(),
          role: UserRole.CUSTOMER,
          isVerified: true,
        },
      });
      isNewUser = true;
    } else {
      if (!user.isVerified) {
        await this.prisma.user.update({ where: { id: user.id }, data: { isVerified: true } });
      }
    }

    const tokens = await this.tokens.issuePair(user, meta);

    await this.audit.record({
      userId: user.id,
      action: AuditAction.OTP_VERIFIED,
      entity: 'User',
      entityId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: { isNewUser },
    });

    return {
      user: { id: user.id, phone: user.phone, firstName: user.firstName, role: user.role },
      tokens,
      isNewUser,
    };
  }

  async refresh(refreshToken: string, meta: AuthMeta): Promise<TokenPair> {
    return this.tokens.rotate(refreshToken, meta);
  }

  async logout(refreshToken: string, userId: string, meta: AuthMeta): Promise<void> {
    await this.tokens.revoke(refreshToken);
    await this.audit.record({
      userId,
      action: AuditAction.USER_LOGOUT,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }
}
