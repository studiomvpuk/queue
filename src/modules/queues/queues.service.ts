import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BookingStatus } from '@prisma/client';

interface QueueState {
  locationId: string;
  activeCount: number;
  position?: number;
  aheadCount?: number;
  etaMinutes?: number;
}

@Injectable()
export class QueuesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Compute live queue state for a location.
   * Returns active booking count, and optionally position/ETA for a specific booking.
   */
  async getQueueState(locationId: string, bookingId?: string): Promise<QueueState> {
    const location = await this.prisma.location.findUnique({
      where: { id: locationId },
    });
    if (!location) {
      throw new NotFoundException('Location not found');
    }

    // Count active bookings
    const activeCount = await this.prisma.booking.count({
      where: {
        locationId,
        status: { in: [BookingStatus.CONFIRMED, BookingStatus.ARRIVED] },
        slotStart: { gte: new Date() },
      },
    });

    const result: QueueState = {
      locationId,
      activeCount,
    };

    if (bookingId) {
      const booking = await this.prisma.booking.findUnique({
        where: { id: bookingId },
      });
      if (!booking || booking.locationId !== locationId) {
        throw new NotFoundException('Booking not found');
      }

      const aheadCount = await this.prisma.booking.count({
        where: {
          locationId,
          slotStart: { lt: booking.slotStart },
          status: { in: [BookingStatus.CONFIRMED, BookingStatus.ARRIVED] },
        },
      });

      const position = aheadCount + 1;
      const etaMinutes = aheadCount * (location.avgServiceSec / 60);

      result.position = position;
      result.aheadCount = aheadCount;
      result.etaMinutes = Math.round(etaMinutes);
    }

    return result;
  }
}
