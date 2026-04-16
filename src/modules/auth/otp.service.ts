import { BadRequestException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { randomInt } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { SmsService } from '../notifications/sms/sms.service';
import { EmailService } from '../notifications/email/email.service';
import { OtpChannel } from './dto/request-otp.dto';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly sms: SmsService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  /** Normalise Nigerian phone to E.164 (+234...) */
  normalisePhone(raw: string): string {
    if (raw.startsWith('+234')) return raw;
    if (raw.startsWith('0') && raw.length === 11) return `+234${raw.slice(1)}`;
    return raw;
  }

  /**
   * The "identifier" is the normalised value we store in OtpRequest.phone.
   * For email channel we use the email address directly; for phone we
   * normalise to E.164.
   */
  private resolveIdentifier(channel: OtpChannel, phone?: string, emailAddr?: string): string {
    if (channel === OtpChannel.EMAIL) {
      if (!emailAddr) throw new BadRequestException('Email required for email OTP');
      return emailAddr.trim().toLowerCase();
    }
    if (!phone) throw new BadRequestException('Phone required for phone OTP');
    return this.normalisePhone(phone);
  }

  async issue(
    channel: OtpChannel,
    phone: string | undefined,
    emailAddr: string | undefined,
    ip?: string,
    userAgent?: string,
  ): Promise<{ expiresAt: Date }> {
    const identifier = this.resolveIdentifier(channel, phone, emailAddr);

    // IP-level flood guard
    if (ip) {
      const ipKey = `otp:ip:${ip}`;
      const ipCount = await this.redis.increment(ipKey, 3600);
      if (ipCount > 20) {
        throw new HttpException(
          { error: 'RATE_LIMITED', message: 'Too many OTPs from this IP' },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    // Per-identifier cooldown
    const cooldownKey = `otp:cooldown:${identifier}`;
    const cooldown = this.config.get<number>('OTP_RESEND_COOLDOWN_SECONDS') ?? 60;
    try {
      const remaining = await this.redis.client.ttl(cooldownKey);
      if (remaining > 0) {
        throw new HttpException(
          { error: 'COOLDOWN', message: `Wait ${remaining}s before requesting another code` },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // Redis down — skip cooldown check
    }

    // Generate, hash, persist
    const length = this.config.get<number>('OTP_LENGTH') ?? 6;
    const code = this.generateCode(length);
    const codeHash = await argon2.hash(code, { type: argon2.argon2id });
    const ttl = this.config.get<number>('OTP_TTL_SECONDS') ?? 300;
    const expiresAt = new Date(Date.now() + ttl * 1000);

    // Invalidate unconsumed prior OTPs for this identifier
    await this.prisma.otpRequest.updateMany({
      where: { phone: identifier, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { expiresAt: new Date() },
    });

    await this.prisma.otpRequest.create({
      data: { phone: identifier, codeHash, expiresAt, ip, userAgent },
    });

    // Deliver OTP via the chosen channel — propagate failures so the client
    // knows the code was never delivered instead of silently succeeding.
    try {
      if (channel === OtpChannel.EMAIL) {
        await this.email.sendOtp(identifier, code);
      } else {
        await this.sms.sendOtp(identifier, code);
      }
    } catch (err) {
      this.logger.error(`OTP delivery failed (${channel}): ${(err as Error).message}`);
      throw new HttpException(
        {
          error: 'DELIVERY_FAILED',
          message: `Could not deliver OTP via ${channel}. Please try again later.`,
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    // Set cooldown
    try {
      await this.redis.client.set(cooldownKey, '1', 'EX', cooldown);
    } catch {
      // Redis down — skip cooldown set
    }

    return { expiresAt };
  }

  async verify(
    channel: OtpChannel,
    phone: string | undefined,
    emailAddr: string | undefined,
    code: string,
  ): Promise<{ identifier: string; channel: OtpChannel }> {
    const identifier = this.resolveIdentifier(channel, phone, emailAddr);
    const maxAttempts = this.config.get<number>('OTP_MAX_ATTEMPTS') ?? 5;

    const record = await this.prisma.otpRequest.findFirst({
      where: { phone: identifier, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) {
      throw new BadRequestException({ error: 'INVALID_OTP', message: 'Invalid or expired code' });
    }

    if (record.attempts >= maxAttempts) {
      await this.prisma.otpRequest.update({ where: { id: record.id }, data: { expiresAt: new Date() } });
      throw new BadRequestException({ error: 'INVALID_OTP', message: 'Invalid or expired code' });
    }

    const ok = await argon2.verify(record.codeHash, code);

    if (!ok) {
      await this.prisma.otpRequest.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException({ error: 'INVALID_OTP', message: 'Invalid or expired code' });
    }

    await this.prisma.otpRequest.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });

    return { identifier, channel };
  }

  private generateCode(length: number): string {
    const min = 10 ** (length - 1);
    const max = 10 ** length;
    return randomInt(min, max).toString();
  }
}
