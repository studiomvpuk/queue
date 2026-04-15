import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationTier, NotificationChannel, BookingStatus } from '@prisma/client';
import { PushService } from './push/push.service';
import { SmsService } from './sms/sms.service';

/**
 * TierSchedulerService runs every 15 seconds.
 * Scans CONFIRMED bookings and creates Notifications for position tiers (10/5/3/YOUR_TURN).
 * Respects user notification preferences (PUSH, SMS).
 */
@Injectable()
export class TierSchedulerService {
  private readonly logger = new Logger('TierSchedulerService');
  // Simple in-process overlap guard. The scheduler runs every 15s and
  // becomes more expensive at scale; without this two ticks could race
  // and emit duplicate notifications (the dedup row is created mid-tick).
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
    private readonly sms: SmsService,
  ) {}

  // EVERY_15_SECONDS is not in @nestjs/schedule's CronExpression enum;
  // use the raw 6-field expression (with seconds field).
  @Cron('*/15 * * * * *')
  async processNotificationTiers(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // Pull CONFIRMED + ARRIVED bookings together. ARRIVED users are
      // physically present and should still count as "ahead" of CONFIRMED
      // users behind them in the queue.
      const bookings = await this.prisma.booking.findMany({
        where: {
          status: { in: [BookingStatus.CONFIRMED, BookingStatus.ARRIVED] },
        },
        include: {
          user: { include: { pushTokens: true } },
          notifications: { select: { tier: true, channel: true } },
        },
        orderBy: [{ locationId: 'asc' }, { slotStart: 'asc' }],
      });

      // Compute positions in one O(N) pass. The list is already sorted by
      // (locationId, slotStart), so the index inside each location group is
      // the "ahead count" for that booking.
      let currentLocation = '';
      let positionInLocation = 0;
      const positioned: Array<{
        booking: (typeof bookings)[number];
        ahead: number;
      }> = [];
      for (const b of bookings) {
        if (b.locationId !== currentLocation) {
          currentLocation = b.locationId;
          positionInLocation = 0;
        }
        positioned.push({ booking: b, ahead: positionInLocation });
        positionInLocation += 1;
      }

      for (const { booking, ahead } of positioned) {
        // Only fire tiers for users still waiting (not already arrived/serving).
        if (booking.status !== BookingStatus.CONFIRMED) continue;

        const tier = this.tierForPosition(ahead);
        if (!tier) continue;

        // Dedup: same booking + tier already recorded?
        if (booking.notifications.some((n) => n.tier === tier)) continue;

        const channels = this.resolveChannels(booking.user?.notificationPref);

        for (const channel of channels) {
          await this.prisma.notification.create({
            data: { bookingId: booking.id, tier, channel },
          });

          if (channel === NotificationChannel.PUSH && booking.user?.pushTokens.length) {
            await this.push.notifyBooking(booking.id, tier);
          } else if (channel === NotificationChannel.SMS && booking.user?.phone) {
            await this.sms.notifyBooking(booking.id, tier);
          }
        }

        this.logger.log(
          `Tier ${tier} fired for booking ${booking.id} (ahead=${ahead})`,
        );
      }
    } catch (err) {
      this.logger.error('Error processing notification tiers:', err);
    } finally {
      this.running = false;
    }
  }

  private tierForPosition(ahead: number): NotificationTier | null {
    if (ahead === 0) return NotificationTier.YOUR_TURN;
    if (ahead <= 2) return NotificationTier.POSITION_3;
    if (ahead <= 4) return NotificationTier.POSITION_5;
    if (ahead <= 9) return NotificationTier.POSITION_10;
    return null;
  }

  private resolveChannels(pref: unknown): NotificationChannel[] {
    const userPrefs = (pref as Record<string, unknown>) ?? {};
    if (Object.keys(userPrefs).length === 0) return [NotificationChannel.PUSH];
    return Object.entries(userPrefs)
      .filter(([, enabled]) => enabled === true)
      .map(([ch]) => ch as NotificationChannel);
  }

  /**
   * SMS failure reconciliation: runs every 60 seconds.
   * Finds PUSH notifications that failed and retries via SMS if user has SMS enabled.
   */
  @Cron('0 * * * * *')
  async retryFailedNotificationsAsSms(): Promise<void> {
    try {
      // Find failed PUSH notifications
      const failed = await this.prisma.notification.findMany({
        where: {
          channel: NotificationChannel.PUSH,
          sentAt: null,
          failedAt: { not: null },
          createdAt: {
            gte: new Date(Date.now() - 30 * 60 * 1000), // Last 30 minutes
          },
        },
        include: { booking: { include: { user: true } } },
        take: 50,
      });

      for (const notif of failed) {
        const user = notif.booking.user;
        if (!user?.phone) {
          continue;
        }

        // Check if user has SMS enabled
        const smsEnabled =
          (user.notificationPref as Record<string, unknown>)?.[
            NotificationChannel.SMS
          ] === true;

        if (!smsEnabled) {
          continue;
        }

        // Create SMS notification and send
        const smsNotif = await this.prisma.notification.create({
          data: {
            bookingId: notif.bookingId,
            tier: notif.tier,
            channel: NotificationChannel.SMS,
          },
        });

        await this.sms.notifyBooking(notif.bookingId, notif.tier);
        this.logger.log(
          `Retried failed PUSH as SMS for booking ${notif.bookingId}`,
        );
      }
    } catch (err) {
      this.logger.error('Error in SMS retry reconciliation:', err);
    }
  }

}
