import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuditAction, User } from '@prisma/client';
import { UpdateUserDto } from './dto/update-user.dto';
import { RegisterPushTokenDto } from './dto/push-token.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Get current user's full profile.
   */
  async getMe(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  /**
   * Update user profile. Calls AuditService.
   */
  async updateMe(userId: string, dto: UpdateUserDto, ip?: string, userAgent?: string): Promise<User> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.firstName && { firstName: dto.firstName }),
        ...(dto.email && { email: dto.email }),
      },
    });

    await this.audit.record({
      userId,
      action: AuditAction.PERMISSIONS_CHANGED,
      entity: 'User',
      entityId: userId,
      ip,
      userAgent,
    });

    return user;
  }

  /**
   * Soft-delete user (set deletedAt). Calls AuditService.
   */
  async softDeleteMe(userId: string, ip?: string, userAgent?: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      userId,
      action: AuditAction.USER_LOGOUT,
      entity: 'User',
      entityId: userId,
      ip,
      userAgent,
      metadata: { reason: 'account_deleted' },
    });
  }

  /**
   * Register an Expo push token for this user.
   */
  async registerPushToken(userId: string, dto: RegisterPushTokenDto): Promise<void> {
    // Check if token already exists for this user
    const existing = await this.prisma.pushToken.findUnique({
      where: { token: dto.token },
    });

    if (existing && existing.userId !== userId) {
      // Token registered to a different user — disassociate
      await this.prisma.pushToken.delete({ where: { token: dto.token } });
    }

    // Upsert: create or update lastSeen
    await this.prisma.pushToken.upsert({
      where: { token: dto.token },
      create: {
        userId,
        token: dto.token,
        platform: dto.platform,
      },
      update: {
        userId,
        platform: dto.platform,
        lastSeen: new Date(),
      },
    });
  }
}
