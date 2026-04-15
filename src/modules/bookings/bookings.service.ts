import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { Booking, BookingSource, BookingStatus, AuditAction, UserRole } from '@prisma/client';
import { nanoid } from 'nanoid';
import { CreateBookingDto } from './dto/create-booking.dto';
import { CreateWalkInDto } from './dto/walk-in.dto';
import { QueuesGateway } from '../queues/queues.gateway';

export interface TicketResponse {
  bookingId: string;
  code: string;
  position: number;
  aheadCount: number;
  etaMinutes: number;
  nowServingCode: string | null;
  status: BookingStatus;
  locationName: string;
  lastUpdatedAt: string;
  virtualRoomUrl: string | null;
}

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly gateway: QueuesGateway,
  ) {}

  /**
   * Create a booking with transactional slot validation, 3-active cap, and WS broadcast.
   */
  async createBooking(userId: string, dto: CreateBookingDto, ip?: string, userAgent?: string): Promise<Booking> {
    const location = await this.prisma.location.findUnique({
      where: { id: dto.locationId },
    });
    if (!location || location.deletedAt) {
      throw new NotFoundException('Location not found');
    }

    // Check user ban status
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.bannedUntil && user.bannedUntil > new Date()) {
      throw new ForbiddenException('User is temporarily banned');
    }

    // Caps per PRD §1.4:
    //   - At most 1 active ticket per user per location
    //   - At most 3 active tickets per user across all locations
    const [activePerLocation, activeTotal] = await Promise.all([
      this.prisma.booking.count({
        where: {
          userId,
          locationId: dto.locationId,
          status: { in: [BookingStatus.CONFIRMED, BookingStatus.ARRIVED] },
          slotStart: { gte: new Date() },
        },
      }),
      this.prisma.booking.count({
        where: {
          userId,
          status: { in: [BookingStatus.CONFIRMED, BookingStatus.ARRIVED] },
          slotStart: { gte: new Date() },
        },
      }),
    ]);
    if (activePerLocation >= 1) {
      throw new ConflictException('You already have an active booking at this location');
    }
    if (activeTotal >= 3) {
      throw new ConflictException('Maximum 3 active bookings allowed');
    }

    // Compute slot end time
    const slotStart = new Date(dto.slotStart);
    const slotEnd = new Date(slotStart.getTime() + location.slotDurationMin * 60000);

    // Transactional booking creation with serializable isolation to prevent double-booking
    let booking: Booking;
    try {
      booking = await this.prisma.$transaction(
        async (tx) => {
          // Check slot availability via unique constraint
          const existing = await tx.booking.findUnique({
            where: {
              locationId_slotStart_userId: {
                locationId: dto.locationId,
                slotStart,
                userId,
              },
            },
          });
          if (existing) {
            throw new ConflictException('Slot already booked by this user');
          }

          // Generate short check-in code
          const code = this.generateCheckInCode();

          // Create booking
          return await tx.booking.create({
            data: {
              code,
              userId,
              locationId: dto.locationId,
              slotStart,
              slotEnd,
              status: BookingStatus.CONFIRMED,
              source: 'APP' as const,
            },
          });
        },
        { isolationLevel: 'Serializable', timeout: 10000 },
      );
    } catch (err) {
      if ((err as any).message?.includes('Slot already booked')) {
        throw new ConflictException('Slot already booked');
      }
      throw err;
    }

    // Calculate position and broadcast
    const position = await this.getPosition(booking.id);
    await this.gateway.broadcastLocationUpdate(dto.locationId, {
      type: 'booking_created',
      bookingId: booking.id,
      code: booking.code,
      position,
    });

    // Notify user via WS
    await this.gateway.notifyUser(userId, {
      type: 'booking_confirmed',
      bookingId: booking.id,
      code: booking.code,
    });

    await this.audit.record({
      userId,
      action: AuditAction.BOOKING_CREATED,
      entity: 'Booking',
      entityId: booking.id,
      ip,
      userAgent,
      metadata: { locationId: dto.locationId, slotStart: slotStart.toISOString() },
    });

    return booking;
  }

  /**
   * Get user's active and recent bookings.
   */
  /**
   * Add a walk-in customer to a location's queue (staff only).
   *
   * PRD §1.10:
   *   - One-tap add (name and phone are both optional).
   *   - Walk-in capacity never exceeds the configured percentage of today's
   *     bookings unless `override=true` is explicitly set.
   *   - Walk-ins are tagged with source=WALK_IN so the dashboard can
   *     visually distinguish them.
   */
  async addWalkIn(
    dto: CreateWalkInDto,
    staffUserId: string,
    userRole: UserRole,
    ip?: string,
    userAgent?: string,
  ): Promise<Booking> {
    if (
      userRole !== UserRole.STAFF &&
      userRole !== UserRole.MANAGER &&
      userRole !== UserRole.OWNER
    ) {
      throw new ForbiddenException('Only staff can add walk-ins');
    }

    const location = await this.prisma.location.findUnique({ where: { id: dto.locationId } });
    if (!location || location.deletedAt) {
      throw new NotFoundException('Location not found');
    }

    // Walk-in capacity check (PRD §1.10): % of today's bookings.
    if (!dto.override) {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

      const [totalToday, walkInsToday] = await Promise.all([
        this.prisma.booking.count({
          where: {
            locationId: dto.locationId,
            slotStart: { gte: startOfDay, lt: endOfDay },
            status: { not: BookingStatus.CANCELLED },
          },
        }),
        this.prisma.booking.count({
          where: {
            locationId: dto.locationId,
            source: BookingSource.WALK_IN,
            slotStart: { gte: startOfDay, lt: endOfDay },
            status: { not: BookingStatus.CANCELLED },
          },
        }),
      ]);

      const projectedPercent = ((walkInsToday + 1) / Math.max(totalToday + 1, 1)) * 100;
      if (projectedPercent > location.walkInPercent) {
        throw new ConflictException({
          error: 'WALK_IN_CAPACITY',
          message: `Walk-in reserve (${location.walkInPercent}%) reached. Pass override=true to add anyway.`,
        });
      }
    }

    const now = new Date();
    const slotEnd = new Date(now.getTime() + location.slotDurationMin * 60000);
    const code = this.generateCheckInCode();

    const booking = await this.prisma.booking.create({
      data: {
        code,
        userId: null,
        walkInName: dto.name?.trim() || null,
        walkInPhone: dto.phone || null,
        locationId: dto.locationId,
        slotStart: now,
        slotEnd,
        status: BookingStatus.ARRIVED, // walk-ins are physically present immediately
        source: BookingSource.WALK_IN,
        arrivedAt: now,
      },
    });

    await this.gateway.broadcastLocationUpdate(dto.locationId, {
      type: 'walk_in_added',
      bookingId: booking.id,
      code: booking.code,
    });

    await this.audit.record({
      userId: staffUserId,
      action: AuditAction.BOOKING_CREATED,
      entity: 'Booking',
      entityId: booking.id,
      ip,
      userAgent,
      metadata: { source: 'WALK_IN', override: !!dto.override },
    });

    return booking;
  }

  /**
   * Staff dashboard: today's bookings at a location, grouped by status.
   * Returns { upcoming, inQueue, served } where:
   *   - upcoming = CONFIRMED, slot still in the future
   *   - inQueue  = ARRIVED or SERVING
   *   - served   = SERVED today (capped at 20 newest)
   */
  async getLocationQueue(locationId: string) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
    const now = new Date();

    const bookings = await this.prisma.booking.findMany({
      where: {
        locationId,
        slotStart: { gte: startOfDay, lt: endOfDay },
        status: {
          in: [
            BookingStatus.CONFIRMED,
            BookingStatus.ARRIVED,
            BookingStatus.SERVING,
            BookingStatus.SERVED,
          ],
        },
      },
      include: { user: { select: { id: true, firstName: true, phone: true } } },
      orderBy: { slotStart: 'asc' },
    });

    return {
      upcoming: bookings.filter(
        (b) => b.status === BookingStatus.CONFIRMED && b.slotStart >= now,
      ),
      inQueue: bookings.filter(
        (b) => b.status === BookingStatus.ARRIVED || b.status === BookingStatus.SERVING,
      ),
      served: bookings
        .filter((b) => b.status === BookingStatus.SERVED)
        .sort((a, b) => (b.servedEndAt?.getTime() ?? 0) - (a.servedEndAt?.getTime() ?? 0))
        .slice(0, 20),
    };
  }

  /**
   * PRD §2.2: history surfaces the last 30 visits server-side. The
   * `range` flag splits this into:
   *   - 'active' — CONFIRMED/ARRIVED/SERVING with a future or current slot
   *   - 'past'   — last 30 SERVED/CANCELLED/NO_SHOW, newest first
   *   - undefined — both, capped at 50 (legacy behaviour for callers that
   *                 want everything in one round-trip).
   *
   * Each row is enriched with `review: { id, rating } | null` so clients
   * can stop guessing whether a booking has been rated.
   */
  async getMyBookings(userId: string, range?: 'active' | 'past') {
    const now = new Date();
    const include = {
      location: true,
      review: { select: { id: true, rating: true } },
    } as const;

    if (range === 'active') {
      return this.prisma.booking.findMany({
        where: {
          userId,
          status: {
            in: [BookingStatus.CONFIRMED, BookingStatus.ARRIVED, BookingStatus.SERVING],
          },
          slotStart: { gte: new Date(now.getTime() - 60 * 60 * 1000) }, // 1h grace
        },
        include,
        orderBy: { slotStart: 'asc' },
        take: 20,
      });
    }

    if (range === 'past') {
      return this.prisma.booking.findMany({
        where: {
          userId,
          status: {
            in: [BookingStatus.SERVED, BookingStatus.CANCELLED, BookingStatus.NO_SHOW],
          },
        },
        include,
        orderBy: { slotStart: 'desc' },
        take: 30,
      });
    }

    return this.prisma.booking.findMany({
      where: {
        userId,
        OR: [
          {
            status: {
              in: [BookingStatus.CONFIRMED, BookingStatus.ARRIVED, BookingStatus.SERVING],
            },
            slotStart: { gte: new Date(now.getTime() - 60 * 60 * 1000) },
          },
          {
            status: {
              in: [BookingStatus.SERVED, BookingStatus.CANCELLED, BookingStatus.NO_SHOW],
            },
          },
        ],
      },
      include,
      orderBy: { slotStart: 'desc' },
      take: 50,
    });
  }

  /**
   * Cancel a booking. Fails if the slot has already passed.
   *
   * PRD §1.7 strike system: cancellations within 2 hours of slotStart count
   * as a strike. Three strikes in 30 days → 24h booking cooldown.
   */
  async cancelBooking(bookingId: string, userId: string, ip?: string, userAgent?: string): Promise<void> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!booking || booking.userId !== userId) {
      throw new NotFoundException('Booking not found');
    }

    if (booking.slotStart < new Date()) {
      throw new ConflictException('Cannot cancel booking after slot time');
    }

    const isLate = booking.slotStart.getTime() - Date.now() <= 2 * 60 * 60 * 1000;

    await this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.CANCELLED, cancelledAt: new Date() },
    });

    if (isLate) {
      await this.applyStrike(userId);
    }

    await this.gateway.broadcastLocationUpdate(booking.locationId, {
      type: 'booking_cancelled',
      bookingId,
    });

    await this.audit.record({
      userId,
      action: AuditAction.BOOKING_CANCELLED,
      entity: 'Booking',
      entityId: bookingId,
      ip,
      userAgent,
      metadata: { lateCancellation: isLate },
    });
  }

  /**
   * Reschedule a confirmed booking to a new slotStart. Two-step flow on the
   * client (pick → confirm); the API itself is one atomic operation.
   *
   * Same caps as createBooking: a user can't end up with two active bookings
   * at the same location, and the moved booking can't conflict with an
   * existing booking row at the new slot.
   */
  async rescheduleBooking(
    bookingId: string,
    userId: string,
    newSlotStartIso: string,
    ip?: string,
    userAgent?: string,
  ): Promise<Booking> {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking || booking.userId !== userId) {
      throw new NotFoundException('Booking not found');
    }
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new ConflictException('Only confirmed bookings can be rescheduled');
    }

    const newSlotStart = new Date(newSlotStartIso);
    if (Number.isNaN(newSlotStart.getTime()) || newSlotStart < new Date()) {
      throw new BadRequestException('New slot must be in the future');
    }

    // Banned users cannot reschedule into the future either.
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.bannedUntil && user.bannedUntil > new Date()) {
      throw new ForbiddenException('User is temporarily banned');
    }

    const location = await this.prisma.location.findUnique({ where: { id: booking.locationId } });
    if (!location) throw new NotFoundException('Location not found');
    const newSlotEnd = new Date(newSlotStart.getTime() + location.slotDurationMin * 60000);

    try {
      const updated = await this.prisma.$transaction(
        async (tx) => {
          const conflict = await tx.booking.findUnique({
            where: {
              locationId_slotStart_userId: {
                locationId: booking.locationId,
                slotStart: newSlotStart,
                userId,
              },
            },
          });
          if (conflict && conflict.id !== bookingId) {
            throw new ConflictException('Slot already booked');
          }
          return tx.booking.update({
            where: { id: bookingId },
            data: { slotStart: newSlotStart, slotEnd: newSlotEnd },
          });
        },
        { isolationLevel: 'Serializable', timeout: 10000 },
      );

      await this.gateway.broadcastLocationUpdate(booking.locationId, {
        type: 'booking_rescheduled',
        bookingId,
      });
      await this.gateway.notifyUser(userId, {
        type: 'booking_rescheduled',
        bookingId,
        slotStart: newSlotStart.toISOString(),
      });

      await this.audit.record({
        userId,
        action: AuditAction.BOOKING_UPDATED,
        entity: 'Booking',
        entityId: bookingId,
        ip,
        userAgent,
        metadata: {
          from: booking.slotStart.toISOString(),
          to: newSlotStart.toISOString(),
        },
      });

      return updated;
    } catch (err) {
      if ((err as any).message?.includes('Slot already booked')) {
        throw new ConflictException('Slot already booked');
      }
      throw err;
    }
  }

  private async applyStrike(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    // Reset the counter if the 30-day window has lapsed.
    const windowExpired = user.strikeResetAt && user.strikeResetAt < new Date();
    const strikes = windowExpired ? 1 : (user.strikes ?? 0) + 1;
    const banUntil =
      strikes >= 3 ? new Date(Date.now() + 24 * 60 * 60 * 1000) : undefined;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        strikes,
        strikeResetAt: windowExpired || strikes === 1
          ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
          : undefined,
        ...(banUntil && { bannedUntil: banUntil }),
      },
    });
  }

  /**
   * User marks arrival. Updates status to ARRIVED.
   */
  async markArrived(bookingId: string, userId: string, ip?: string, userAgent?: string): Promise<Booking> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!booking || booking.userId !== userId) {
      throw new NotFoundException('Booking not found');
    }

    const updated = await this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: BookingStatus.ARRIVED,
        arrivedAt: new Date(),
      },
    });

    await this.gateway.broadcastLocationUpdate(booking.locationId, {
      type: 'booking_arrived',
      bookingId,
    });

    await this.audit.record({
      userId,
      action: AuditAction.BOOKING_CREATED, // reuse for now, could have dedicated action
      entity: 'Booking',
      entityId: bookingId,
      ip,
      userAgent,
    });

    return updated;
  }

  /**
   * Staff marks booking as being served. STAFF role only.
   */
  async markServing(
    bookingId: string,
    staffUserId: string,
    userRole: UserRole,
    ip?: string,
    userAgent?: string,
  ): Promise<Booking> {
    if (userRole !== UserRole.STAFF && userRole !== UserRole.MANAGER && userRole !== UserRole.OWNER) {
      throw new ForbiddenException('Only staff can serve');
    }

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    const updated = await this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: BookingStatus.SERVING,
        servedStartAt: new Date(),
      },
    });

    await this.gateway.broadcastLocationUpdate(booking.locationId, {
      type: 'booking_serving',
      bookingId,
    });

    await this.audit.record({
      userId: staffUserId,
      action: AuditAction.BOOKING_CREATED, // placeholder
      entity: 'Booking',
      entityId: bookingId,
      ip,
      userAgent,
    });

    return updated;
  }

  /**
   * Staff marks booking as served (complete). STAFF role only.
   */
  async markServed(
    bookingId: string,
    staffUserId: string,
    userRole: UserRole,
    ip?: string,
    userAgent?: string,
  ): Promise<Booking> {
    if (userRole !== UserRole.STAFF && userRole !== UserRole.MANAGER && userRole !== UserRole.OWNER) {
      throw new ForbiddenException('Only staff can serve');
    }

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    const updated = await this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: BookingStatus.SERVED,
        servedEndAt: new Date(),
      },
    });

    await this.gateway.broadcastLocationUpdate(booking.locationId, {
      type: 'booking_served',
      bookingId,
    });

    await this.audit.record({
      userId: staffUserId,
      action: AuditAction.BOOKING_SERVED,
      entity: 'Booking',
      entityId: bookingId,
      ip,
      userAgent,
    });

    return updated;
  }

  /**
   * Staff marks booking as no-show. Increments strike counter.
   */
  async markNoShow(
    bookingId: string,
    staffUserId: string,
    userRole: UserRole,
    ip?: string,
    userAgent?: string,
  ): Promise<Booking> {
    if (userRole !== UserRole.STAFF && userRole !== UserRole.MANAGER && userRole !== UserRole.OWNER) {
      throw new ForbiddenException('Only staff can mark no-show');
    }

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!booking || !booking.userId) {
      throw new NotFoundException('Booking not found');
    }

    const updated = await this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: BookingStatus.NO_SHOW,
        noShowAt: new Date(),
      },
    });

    // Increment strike counter
    const user = await this.prisma.user.findUnique({ where: { id: booking.userId } });
    const newStrikes = (user?.strikes ?? 0) + 1;

    // If 3 strikes in 30 days, ban for 24 hours
    let bannedUntil: Date | null = null;
    if (newStrikes >= 3 && (!user?.strikeResetAt || user.strikeResetAt < new Date())) {
      bannedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
    }

    await this.prisma.user.update({
      where: { id: booking.userId },
      data: {
        strikes: newStrikes,
        strikeResetAt: newStrikes >= 3 ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : undefined,
        ...(bannedUntil && { bannedUntil }),
      },
    });

    await this.gateway.broadcastLocationUpdate(booking.locationId, {
      type: 'booking_no_show',
      bookingId,
    });

    await this.audit.record({
      userId: staffUserId,
      action: AuditAction.BOOKING_NO_SHOW,
      entity: 'Booking',
      entityId: bookingId,
      ip,
      userAgent,
      metadata: { userStrikesNow: newStrikes },
    });

    return updated;
  }

  /**
   * Get booking ticket state (position, ahead count, ETA). One booking
   * fetch + one location fetch + two parallel counts — was four sequential
   * queries before.
   */
  async getTicket(bookingId: string): Promise<TicketResponse> {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    const [location, ahead, aheadInclusive, nowServing] = await Promise.all([
      this.prisma.location.findUnique({ where: { id: booking.locationId } }),
      this.prisma.booking.count({
        where: {
          locationId: booking.locationId,
          slotStart: { lt: booking.slotStart },
          status: { in: [BookingStatus.CONFIRMED, BookingStatus.ARRIVED] },
        },
      }),
      this.prisma.booking.count({
        where: {
          locationId: booking.locationId,
          slotStart: { lte: booking.slotStart },
          status: { in: [BookingStatus.CONFIRMED, BookingStatus.ARRIVED] },
          id: { not: bookingId },
        },
      }),
      this.prisma.booking.findFirst({
        where: { locationId: booking.locationId, status: BookingStatus.SERVING },
        orderBy: { servedStartAt: 'desc' },
        select: { code: true },
      }),
    ]);

    const etaMinutes = location ? ahead * (location.avgServiceSec / 60) : 0;

    // Phase 3: only surface the room URL while it's still valid.
    const virtualRoomValid =
      booking.virtualRoomUrl &&
      booking.virtualRoomExpiresAt &&
      booking.virtualRoomExpiresAt > new Date();

    return {
      bookingId: booking.id,
      code: booking.code,
      position: aheadInclusive + 1,
      aheadCount: ahead,
      etaMinutes: Math.round(etaMinutes),
      nowServingCode: nowServing?.code ?? null,
      status: booking.status,
      locationName: location?.name ?? '',
      lastUpdatedAt: new Date().toISOString(),
      virtualRoomUrl: virtualRoomValid ? booking.virtualRoomUrl : null,
    };
  }

  // --- Private helpers ---

  private generateCheckInCode(): string {
    const char = String.fromCharCode(65 + Math.floor(Math.random() * 26));
    const num = nanoid(2).toUpperCase();
    return `${char}${num}-${Math.floor(Math.random() * 100)}`.substring(0, 7);
  }

  private async getPosition(bookingId: string): Promise<number> {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) return 0;
    const ahead = await this.prisma.booking.count({
      where: {
        locationId: booking.locationId,
        slotStart: { lte: booking.slotStart },
        status: { in: [BookingStatus.CONFIRMED, BookingStatus.ARRIVED] },
        id: { not: bookingId },
      },
    });
    return ahead + 1;
  }
}
