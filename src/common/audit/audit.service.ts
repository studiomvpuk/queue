import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditContext {
  userId?: string | null;
  action: AuditAction;
  entity?: string;
  entityId?: string;
  ip?: string;
  userAgent?: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * AuditService — writes immutable records for security-sensitive events.
 * Fire-and-forget: callers don't await unless they need the id.
 * Failures are logged but never interrupt the primary operation.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(ctx: AuditContext): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: ctx.userId ?? null,
          action: ctx.action,
          entity: ctx.entity,
          entityId: ctx.entityId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          metadata: ctx.metadata,
        },
      });
    } catch {
      // swallow — audit failure must never break the request
    }
  }
}
