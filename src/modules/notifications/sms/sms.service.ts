import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationTier } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * SmsService — Termii primary, Twilio fallback.
 * Phase 1: delivery best-effort, failures logged, non-blocking.
 * Phase 2: persists delivery outcome to Notification rows with provider refs.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async sendOtp(phone: string, code: string): Promise<void> {
    const message = `${code} is your QueueEase code. Valid for 5 minutes. Never share this code.`;
    await this.send(phone, message);
  }

  /**
   * Tier-aware SMS for a booking. The TierSchedulerService creates the
   * Notification row before invoking us; this method resolves the
   * destination phone, composes a tier-specific message, sends it, and
   * stamps sentAt / failedAt on the row.
   *
   * PRD §2.4 cost cap: refuse to send if the user has already received
   * SMS_DAILY_CAP (default 5) successfully delivered SMS today. Prevents
   * spam / runaway cost on bursty queues.
   */
  async notifyBooking(bookingId: string, tier: NotificationTier): Promise<void> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { user: { select: { id: true, phone: true } } },
    });
    if (!booking) return;

    // Walk-in walkInPhone takes precedence for source=WALK_IN bookings.
    const phone = booking.user?.phone ?? booking.walkInPhone ?? null;
    if (!phone) {
      this.logger.debug(`No SMS phone for booking ${bookingId}`);
      return;
    }

    const cap = this.config.get<number>('SMS_DAILY_CAP') ?? 5;
    if (booking.user?.id) {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const sentToday = await this.prisma.notification.count({
        where: {
          channel: 'SMS',
          sentAt: { gte: startOfDay },
          booking: { userId: booking.user.id },
        },
      });
      if (sentToday >= cap) {
        this.logger.warn(
          `SMS cap reached for user ${booking.user.id} (${sentToday}/${cap}); dropping ${tier}`,
        );
        await this.prisma.notification.updateMany({
          where: { bookingId, tier, channel: 'SMS' },
          data: { failedAt: new Date(), failReason: 'DAILY_CAP_REACHED' },
        });
        return;
      }
    }

    const message = this.composeMessage(tier, booking.code);

    try {
      await this.send(phone, message);
      await this.prisma.notification.updateMany({
        where: { bookingId, tier, channel: 'SMS' },
        data: { sentAt: new Date() },
      });
    } catch (err) {
      await this.prisma.notification.updateMany({
        where: { bookingId, tier, channel: 'SMS' },
        data: { failedAt: new Date(), failReason: (err as Error).message },
      });
    }
  }

  private composeMessage(tier: NotificationTier, code: string): string {
    switch (tier) {
      case 'YOUR_TURN':
        return `QueueEase: It's your turn! Code ${code}. Head to the counter now.`;
      case 'POSITION_3':
        return `QueueEase: You're 3 ahead. Code ${code}. Get ready.`;
      case 'POSITION_5':
        return `QueueEase: You're 5 ahead. Code ${code}.`;
      case 'POSITION_10':
        return `QueueEase: You're 10 ahead. Code ${code}.`;
      case 'BOOKING_CONFIRMED':
        return `QueueEase: Booking confirmed. Check-in code ${code}.`;
      case 'BOOKING_CANCELLED':
        return `QueueEase: Your booking has been cancelled.`;
      case 'RATING_PROMPT':
        return `QueueEase: How was your visit? Tap the app to rate.`;
      default:
        return `QueueEase update for ${code}.`;
    }
  }

  async send(phone: string, message: string): Promise<void> {
    // In dev/test with no Termii key configured, just log.
    const termiiKey = this.config.get<string>('TERMII_API_KEY');
    if (!termiiKey) {
      this.logger.warn(`[DEV SMS] to=${phone.slice(0, 6)}*** msg="${message}"`);
      return;
    }

    try {
      await this.sendViaTermii(phone, message);
    } catch (err) {
      this.logger.warn(`Termii failed, falling back to Twilio: ${(err as Error).message}`);
      await this.sendViaTwilio(phone, message);
    }
  }

  private async sendViaTermii(phone: string, message: string): Promise<void> {
    const apiKey = this.config.getOrThrow<string>('TERMII_API_KEY');
    const senderId = this.config.get<string>('TERMII_SENDER_ID') ?? 'QueueEase';

    const res = await fetch('https://api.ng.termii.com/api/sms/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: phone,
        from: senderId,
        sms: message,
        type: 'plain',
        channel: 'generic',
        api_key: apiKey,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Termii ${res.status}: ${body.slice(0, 200)}`);
    }
  }

  private async sendViaTwilio(phone: string, message: string): Promise<void> {
    const sid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const token = this.config.get<string>('TWILIO_AUTH_TOKEN');
    const from = this.config.get<string>('TWILIO_FROM');
    if (!sid || !token || !from) {
      this.logger.error('Twilio not configured; SMS delivery aborted');
      return;
    }

    const body = new URLSearchParams({ To: phone, From: from, Body: message });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Twilio ${res.status}: ${text.slice(0, 200)}`);
    }
  }
}
