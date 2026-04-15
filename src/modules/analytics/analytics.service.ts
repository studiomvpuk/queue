import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { BookingStatus } from '@prisma/client';

export interface AnalyticsResult {
  volumeByHour: Record<number, number>;
  noShowRate: number;
  serviceTimeDistribution: { p50: number; p90: number; p99: number };
  uniqueCustomersPerDay: Record<string, number>;
  weekOverWeekDelta: number;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger('AnalyticsService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * PRD §2.5 — four charts updated hourly with WoW comparisons:
   * volume by hour-of-day, no-show trend, service time percentiles,
   * unique customers per day.
   *
   * The `userId` arg is consumed by the BusinessScopeGuard at the controller
   * layer; this method trusts that membership has already been verified.
   */
  async getLocationAnalytics(
    _userId: string,
    locationId: string,
    range: '7d' | '30d' = '7d',
  ): Promise<AnalyticsResult> {
    const location = await this.prisma.location.findUnique({ where: { id: locationId } });
    if (!location) {
      throw new NotFoundException('Location not found');
    }

    const cacheKey = `analytics:${locationId}:${range}`;
    const cached = await this.redis.getJson<AnalyticsResult>(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit for ${cacheKey}`);
      return cached;
    }

    const days = range === '7d' ? 7 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const bookings = await this.prisma.booking.findMany({
      where: { locationId, createdAt: { gte: startDate } },
      select: {
        id: true,
        userId: true,
        slotStart: true,
        status: true,
        arrivedAt: true,
        servedStartAt: true,
        servedEndAt: true,
        createdAt: true,
      },
    });

    // Volume by hour-of-day
    const volumeByHour: Record<number, number> = {};
    for (let h = 0; h < 24; h++) volumeByHour[h] = 0;
    for (const b of bookings) {
      volumeByHour[new Date(b.slotStart).getHours()]++;
    }

    // No-show rate
    const noShowCount = bookings.filter((b) => b.status === BookingStatus.NO_SHOW).length;
    const noShowRate = bookings.length > 0 ? (noShowCount / bookings.length) * 100 : 0;

    // Service time percentiles
    const serviceTimes = bookings
      .filter((b) => b.servedStartAt && b.servedEndAt)
      .map((b) => (b.servedEndAt!.getTime() - b.servedStartAt!.getTime()) / 1000)
      .sort((a, b) => a - b);

    const percentile = (p: number): number => {
      if (serviceTimes.length === 0) return 0;
      const idx = Math.min(serviceTimes.length - 1, Math.ceil((p / 100) * serviceTimes.length) - 1);
      return serviceTimes[idx] ?? 0;
    };

    const serviceTimeDistribution = {
      p50: percentile(50),
      p90: percentile(90),
      p99: percentile(99),
    };

    // Unique customers per day (distinct userId, walk-ins counted as one bucket each)
    const seenByDay: Record<string, Set<string>> = {};
    for (const b of bookings) {
      const day = b.createdAt.toISOString().slice(0, 10);
      const key = b.userId ?? `walkin:${b.id}`;
      (seenByDay[day] ??= new Set<string>()).add(key);
    }
    const uniqueCustomersPerDay: Record<string, number> = {};
    for (const [day, set] of Object.entries(seenByDay)) {
      uniqueCustomersPerDay[day] = set.size;
    }

    // Week-over-week delta on booking volume
    const now = Date.now();
    const oneWeekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now - 14 * 24 * 60 * 60 * 1000);
    const currentWeek = bookings.filter((b) => b.createdAt >= oneWeekAgo).length;
    const prevWeek = bookings.filter(
      (b) => b.createdAt >= twoWeeksAgo && b.createdAt < oneWeekAgo,
    ).length;
    const wow = prevWeek > 0 ? ((currentWeek - prevWeek) / prevWeek) * 100 : 0;

    const result: AnalyticsResult = {
      volumeByHour,
      noShowRate: Math.round(noShowRate * 100) / 100,
      serviceTimeDistribution,
      uniqueCustomersPerDay,
      weekOverWeekDelta: Math.round(wow * 100) / 100,
    };

    // Cache for 5 minutes
    await this.redis.setJson(cacheKey, result, 300);
    return result;
  }

  async exportAnalyticsCsv(
    _userId: string,
    locationId: string,
    range: '7d' | '30d' = '30d',
  ): Promise<string> {
    // Verify location access (simplified — in real app, check StaffMembership)
    const location = await this.prisma.location.findUnique({
      where: { id: locationId },
    });

    if (!location) {
      throw new NotFoundException('Location not found');
    }

    const days = range === '7d' ? 7 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const bookings = await this.prisma.booking.findMany({
      where: {
        locationId,
        createdAt: { gte: startDate },
      },
      select: {
        code: true,
        status: true,
        slotStart: true,
        arrivedAt: true,
        servedStartAt: true,
        servedEndAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Build CSV
    const headers = [
      'Code',
      'Status',
      'Slot Start',
      'Arrived At',
      'Served Start',
      'Served End',
      'Created At',
    ];

    const rows = bookings.map((b) => [
      b.code,
      b.status,
      new Date(b.slotStart).toISOString(),
      b.arrivedAt ? new Date(b.arrivedAt).toISOString() : '',
      b.servedStartAt ? new Date(b.servedStartAt).toISOString() : '',
      b.servedEndAt ? new Date(b.servedEndAt).toISOString() : '',
      new Date(b.createdAt).toISOString(),
    ]);

    // Properly escape embedded quotes per RFC 4180.
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv =
      [headers, ...rows].map((r) => r.map((v) => escape(String(v))).join(',')).join('\n') + '\n';

    return csv;
  }
}
