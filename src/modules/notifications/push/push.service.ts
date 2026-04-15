import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { NotificationTier, NotificationChannel } from '@prisma/client';
import Expo from 'expo-server-sdk';
import { chunk } from 'lodash';

@Injectable()
export class PushService {
  private readonly logger = new Logger('PushService');
  private readonly expo = new Expo({
    accessToken: process.env.EXPO_ACCESS_TOKEN,
  });

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Send push notification for a booking state change.
   * Tier-specific messages, chunked for Expo limits, recorded to DB.
   */
  async notifyBooking(bookingId: string, tier: NotificationTier): Promise<void> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { user: { include: { pushTokens: true } } },
    });

    if (!booking || !booking.user) {
      this.logger.warn(`Booking ${bookingId} not found or has no user`);
      return;
    }

    const tokens = booking.user.pushTokens
      .filter((t) => Expo.isExpoPushToken(t.token))
      .map((t) => t.token);

    if (tokens.length === 0) {
      this.logger.debug(`No push tokens for booking ${bookingId}`);
      return;
    }

    const message = this.composeMessage(tier, booking.code);

    // Send in chunks (Expo has per-request limits). The scheduler is the
    // sole creator of the Notification row for this (bookingId, tier);
    // we update only that row here. Previously we created an extra row
    // per token and used overly broad updateMany(), polluting the table.
    const chunks = chunk(
      tokens.map((token) => ({
        to: token,
        sound: 'default' as const,
        title: message.title,
        body: message.body,
        data: { bookingId, tier, deepLink: `queueease://ticket/${bookingId}` },
      })),
      100,
    );

    let allOk = true;
    let lastError: string | null = null;
    for (const chunkOfMessages of chunks) {
      try {
        const receipts = await this.expo.sendPushNotificationsAsync(chunkOfMessages);
        this.logger.log(`Sent ${receipts.length} push notifications for booking ${bookingId}`);
      } catch (err) {
        allOk = false;
        lastError = (err as Error).message;
        this.logger.error(`Failed to send push for ${bookingId}:`, err);
      }
    }

    // Update the ONE row owned by this (booking, tier, PUSH) tuple.
    await this.prisma.notification.updateMany({
      where: { bookingId, tier, channel: NotificationChannel.PUSH },
      data: allOk
        ? { sentAt: new Date() }
        : { failedAt: new Date(), failReason: lastError ?? 'unknown' },
    });
  }

  private composeMessage(tier: NotificationTier, code: string): { title: string; body: string } {
    const messages: Record<NotificationTier, { title: string; body: string }> = {
      [NotificationTier.BOOKING_CONFIRMED]: {
        title: 'Booking Confirmed',
        body: `Your booking is confirmed. Check-in code: ${code}`,
      },
      [NotificationTier.BOOKING_CANCELLED]: {
        title: 'Booking Cancelled',
        body: 'Your booking has been cancelled.',
      },
      [NotificationTier.POSITION_10]: {
        title: 'Position 10',
        body: 'You are 10 positions ahead in the queue.',
      },
      [NotificationTier.POSITION_5]: {
        title: 'Position 5',
        body: 'You are 5 positions ahead in the queue.',
      },
      [NotificationTier.POSITION_3]: {
        title: 'Position 3',
        body: 'You are 3 positions ahead. Get ready!',
      },
      [NotificationTier.YOUR_TURN]: {
        title: "It's Your Turn!",
        body: 'You are next in the queue. Proceed to the service point.',
      },
      [NotificationTier.RATING_PROMPT]: {
        title: 'Rate Your Experience',
        body: 'How was your service? Please rate us.',
      },
    };
    return messages[tier];
  }
}
