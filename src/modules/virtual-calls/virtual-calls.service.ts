import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QueuesGateway } from '../queues/queues.gateway';

interface DailyRoomResponse {
  name: string;
  id: string;
  url: string;
  created_at: string;
}

/**
 * Virtual queue calls — PRD §3.2.
 *
 * Staff create a Daily.co room scoped to a single booking. The room URL is
 * persisted on the Booking row (virtualRoomUrl) with a 1-hour TTL so the
 * customer can fetch it via GET /bookings/:id/ticket. We also notify the
 * user over their private socket room so the ticket screen flips into
 * "Join call" mode in real time.
 */
@Injectable()
export class VirtualCallsService {
  private readonly logger = new Logger(VirtualCallsService.name);
  private readonly dailyBaseUrl = 'https://api.daily.co/v1';

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly gateway: QueuesGateway,
  ) {}

  async createVirtualRoom(
    bookingId: string,
    userRole: UserRole,
  ): Promise<{ roomUrl: string; expiresAt: string }> {
    if (
      userRole !== UserRole.STAFF &&
      userRole !== UserRole.MANAGER &&
      userRole !== UserRole.OWNER
    ) {
      throw new ForbiddenException('Only staff can create virtual rooms');
    }

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { location: { select: { virtualEnabled: true } } },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    if (!booking.location.virtualEnabled) {
      throw new BadRequestException('Virtual calls not enabled for this location');
    }

    const dailyKey = this.config.get<string>('DAILY_API_KEY');
    if (!dailyKey) {
      throw new BadRequestException('Daily.co not configured');
    }

    const roomName = `queueease-${booking.code.toLowerCase()}-${Date.now()}`;
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1h

    let roomUrl: string;
    try {
      const httpRes = await fetch(`${this.dailyBaseUrl}/rooms`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${dailyKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: roomName,
          privacy: 'private',
          properties: {
            exp: Math.floor(expiresAt.getTime() / 1000),
            enable_recording: 'cloud-beta', // opt-in (PRD §3.2)
          },
        }),
      });

      if (!httpRes.ok) {
        const txt = await httpRes.text();
        throw new Error(`Daily.co ${httpRes.status}: ${txt.slice(0, 200)}`);
      }

      const data = (await httpRes.json()) as DailyRoomResponse;
      roomUrl = data.url;
    } catch (err) {
      this.logger.error(`Daily.co room creation failed: ${(err as Error).message}`);
      throw new BadRequestException('Failed to create virtual room');
    }

    // Persist on the booking so getTicket can return it.
    await this.prisma.booking.update({
      where: { id: bookingId },
      data: { virtualRoomUrl: roomUrl, virtualRoomExpiresAt: expiresAt },
    });

    // Push the room into the customer's ticket screen in real time.
    if (booking.userId) {
      this.gateway.notifyUser(booking.userId, {
        type: 'virtual:room-ready',
        bookingId,
        roomUrl,
        expiresAt: expiresAt.toISOString(),
      });
    }

    return { roomUrl, expiresAt: expiresAt.toISOString() };
  }
}
