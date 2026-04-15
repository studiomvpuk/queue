import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, BookingStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';

/**
 * Priority slots — PRD §3.1.
 *
 * Capacity rule: at most 20% of `location.maxQueueSize` may be priority on
 * any given day. Accessibility users get priority for free; non-accessibility
 * users pay via Paystack (see PaymentsService).
 *
 * Position rule: priority bookings skip ahead of all non-priority bookings
 * with the same slotStart. Within each priority class, ordering is by
 * createdAt ASC.
 */
@Injectable()
export class PrioritySlotsService {
  private readonly logger = new Logger(PrioritySlotsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async canBookPriority(
    userId: string,
    locationId: string,
    slotDate: Date,
  ): Promise<{ allowed: boolean; remainingSlots: number; isAccessibility: boolean }> {
    const [user, location] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { isAccessibility: true },
      }),
      this.prisma.location.findUnique({
        where: { id: locationId },
        select: { maxQueueSize: true, priorityEnabled: true },
      }),
    ]);

    const isAccessibility = !!user?.isAccessibility;

    if (!location?.priorityEnabled) {
      return { allowed: false, remainingSlots: 0, isAccessibility };
    }

    const dayStart = new Date(slotDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const priorityCount = await this.prisma.booking.count({
      where: {
        locationId,
        isPriority: true,
        slotStart: { gte: dayStart, lt: dayEnd },
        status: { not: BookingStatus.CANCELLED },
      },
    });

    const cap = Math.max(1, Math.floor(location.maxQueueSize * 0.2));
    const remainingSlots = Math.max(0, cap - priorityCount);

    return { allowed: remainingSlots > 0, remainingSlots, isAccessibility };
  }

  async setAccessibility(
    userId: string,
    isAccessibility: boolean,
    proofDocumentUrl?: string,
    ip?: string,
    userAgent?: string,
  ) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { isAccessibility },
    });

    await this.audit.record({
      userId,
      action: AuditAction.ACCESSIBILITY_DECLARED,
      entity: 'User',
      entityId: userId,
      ip,
      userAgent,
      metadata: { isAccessibility, proofDocumentUrl },
    });

    return { isAccessibility };
  }

  /**
   * Position respecting priority. Priority slots skip ahead of all
   * non-priority bookings sharing the same day, ordered by createdAt within
   * each priority class.
   */
  async computeQueuePosition(bookingId: string): Promise<number> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { locationId: true, slotStart: true, isPriority: true, createdAt: true },
    });
    if (!booking) return 0;

    const dayStart = new Date(booking.slotStart);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const baseWhere: Prisma.BookingWhereInput = {
      locationId: booking.locationId,
      slotStart: { gte: dayStart, lt: dayEnd },
      status: {
        in: [BookingStatus.CONFIRMED, BookingStatus.ARRIVED, BookingStatus.SERVING],
      },
    };

    const orClauses: Prisma.BookingWhereInput[] = booking.isPriority
      ? [
          // Earlier priority bookings on the same day
          { isPriority: true, createdAt: { lt: booking.createdAt } },
        ]
      : [
          // Non-priority before me by createdAt
          { isPriority: false, createdAt: { lt: booking.createdAt } },
          // ALL priority bookings skip ahead of me
          { isPriority: true },
        ];

    const aheadCount = await this.prisma.booking.count({
      where: { ...baseWhere, OR: orClauses },
    });

    return aheadCount + 1;
  }
}
