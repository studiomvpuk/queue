import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditAction, User, UserRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { OtpService } from './otp.service';
import { TokenService, TokenPair } from './token.service';
import { OtpChannel } from './dto/request-otp.dto';

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

  async requestOtp(
    channel: OtpChannel,
    phone: string | undefined,
    email: string | undefined,
    meta: AuthMeta,
  ): Promise<{ expiresAt: Date }> {
    const result = await this.otp.issue(channel, phone, email, meta.ip, meta.userAgent);
    await this.audit.record({
      action: AuditAction.OTP_REQUESTED,
      entity: 'OtpRequest',
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: {
        channel,
        ...(channel === OtpChannel.PHONE
          ? { phone: phone?.slice(-4) }
          : { email: email?.slice(0, 3) + '***' }),
      },
    });
    return result;
  }

  async verifyOtp(
    channel: OtpChannel,
    phone: string | undefined,
    email: string | undefined,
    code: string,
    firstName: string | undefined,
    meta: AuthMeta,
  ): Promise<{
    user: Pick<User, 'id' | 'phone' | 'firstName' | 'role'> & { email?: string | null };
    tokens: TokenPair;
    isNewUser: boolean;
  }> {
    const { identifier } = await this.otp.verify(channel, phone, email, code);

    // Look up user by the channel-specific identifier
    let user: User | null;
    if (channel === OtpChannel.EMAIL) {
      user = await this.prisma.user.findUnique({ where: { email: identifier } });
    } else {
      user = await this.prisma.user.findUnique({ where: { phone: identifier } });
    }

    let isNewUser = false;

    if (!user) {
      // Create account — firstName is optional here and can be set later
      // during onboarding via PATCH /users/me
      user = await this.prisma.user.create({
        data: {
          phone: channel === OtpChannel.PHONE ? identifier : '',
          email: channel === OtpChannel.EMAIL ? identifier : undefined,
          firstName: firstName?.trim() || '',
          role: UserRole.CUSTOMER,
          isVerified: true,
        },
      });
      isNewUser = true;
    } else {
      // Update firstName if provided and user doesn't have one
      if (firstName?.trim() && !user.firstName) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { firstName: firstName.trim(), isVerified: true },
        });
      } else if (!user.isVerified) {
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
      metadata: { isNewUser, channel },
    });

    return {
      user: {
        id: user.id,
        phone: user.phone,
        email: user.email,
        firstName: user.firstName,
        role: user.role,
      },
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
