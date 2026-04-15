import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  BookingStatus,
  NotificationChannel,
  NotificationTier,
} from '@prisma/client';
import { PushService } from '../notifications/push/push.service';

/**
 * Rating prompt — fires 15 minutes after a booking enters SERVED state.
 *
 * Implementation note: the original scaffold used Bull; we replaced it with a
 * once-per-minute scan to remove the Bull/Redis-job dependency. The query
 * looks for SERVED bookings whose servedEndAt landed in the [14m, 16m] window
 * and which don't already have a RATING_PROMPT notification, then enqueues
 * one PUSH notification per matched booking.
 */
@Injectable()
export class RatingPromptService {
  private readonly logger = new Logger('RatingPromptService');
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  @Cron('0 * * * * *') // every minute (with seconds field)
  async scanAndSendPrompts(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = Date.now();
      const upper = new Date(now - 14 * 60 * 1000);
      const lower = new Date(now - 16 * 60 * 1000);

      const candidates = await this.prisma.booking.findMany({
        where: {
          status: BookingStatus.SERVED,
          servedEndAt: { gte: lower, lte: upper },
          userId: { not: null },
          notifications: { none: { tier: NotificationTier.RATING_PROMPT } },
        },
        select: { id: true, userId: true },
        take: 200,
      });

      for (const booking of candidates) {
        try {
          await this.prisma.notification.create({
            data: {
              bookingId: booking.id,
              tier: NotificationTier.RATING_PROMPT,
              channel: NotificationChannel.PUSH,
            },
          });
          await this.push.notifyBooking(booking.id, NotificationTier.RATING_PROMPT);
        } catch (err) {
          this.logger.warn(
            `Rating prompt failed for booking ${booking.id}: ${(err as Error).message}`,
          );
        }
      }

      if (candidates.length > 0) {
        this.logger.log(`Dispatched ${candidates.length} rating prompts`);
      }
    } catch (err) {
      this.logger.error('Rating prompt scan failed:', err);
    } finally {
      this.running = false;
    }
  }
}
