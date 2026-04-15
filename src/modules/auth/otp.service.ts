import { BadRequestException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { randomInt } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { SmsService } from '../notifications/sms/sms.service';

/**
 * OtpService — issues + verifies one-time passcodes for phone auth.
 *
 * Security properties:
 *   - Codes stored only as argon2 hashes; plaintext never persisted
 *   - 5-attempt ceiling per code; further attempts invalidate the code
 *   - Per-phone cooldown on resends (configurable, default 60s)
 *   - Per-IP flood control via Redis counter (independent of user-level limit)
 *   - Codes expire in 5 minutes
 *   - Timing-safe verification via argon2.verify
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly sms: SmsService,
    private readonly config: ConfigService,
  ) {}

  /** Normalise to E.164 (+234...) */
  normalisePhone(raw: string): string {
    if (raw.startsWith('+234')) return raw;
    if (raw.startsWith('0') && raw.length === 11) return `+234${raw.slice(1)}`;
    return raw;
  }

  async issue(phone: string, ip?: string, userAgent?: string): Promise<{ expiresAt: Date }> {
    const normalised = this.normalisePhone(phone);

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

    // Phone-level cooldown
    const cooldownKey = `otp:cooldown:${normalised}`;
    const cooldown = this.config.get<number>('OTP_RESEND_COOLDOWN_SECONDS') ?? 60;
    const remaining = await this.redis.client.ttl(cooldownKey);
    if (remaining > 0) {
      throw new HttpException(
        { error: 'COOLDOWN', message: `Wait ${remaining}s before requesting another code` },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Generate, hash, persist
    const length = this.config.get<number>('OTP_LENGTH') ?? 6;
    const code = this.generateCode(length);
    const codeHash = await argon2.hash(code, { type: argon2.argon2id });
    const ttl = this.config.get<number>('OTP_TTL_SECONDS') ?? 300;
    const expiresAt = new Date(Date.now() + ttl * 1000);

    // Invalidate any unconsumed prior OTPs for this phone (single active code policy)
    await this.prisma.otpRequest.updateMany({
      where: { phone: normalised, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { expiresAt: new Date() },
    });

    await this.prisma.otpRequest.create({
      data: { phone: normalised, codeHash, expiresAt, ip, userAgent },
    });

    // Send SMS (best-effort — failure still returns success to avoid leaking phone existence)
    try {
      await this.sms.sendOtp(normalised, code);
    } catch (err) {
      this.logger.error(`SMS failed for ${normalised.slice(0, 6)}***: ${(err as Error).message}`);
    }

    // Set cooldown
    await this.redis.client.set(cooldownKey, '1', 'EX', cooldown);

    return { expiresAt };
  }

  /**
   * Verify a code. Returns normalised phone on success.
   * Throws BadRequest for any failure path — uniform error to prevent enumeration.
   */
  async verify(phone: string, code: string): Promise<{ phone: string }> {
    const normalised = this.normalisePhone(phone);
    const maxAttempts = this.config.get<number>('OTP_MAX_ATTEMPTS') ?? 5;

    const record = await this.prisma.otpRequest.findFirst({
      where: { phone: normalised, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) {
      throw new BadRequestException({ error: 'INVALID_OTP', message: 'Invalid or expired code' });
    }

    if (record.attempts >= maxAttempts) {
      // Burn the record so subsequent attempts find nothing
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

    return { phone: normalised };
  }

  private generateCode(length: number): string {
    // Cryptographically strong 6-digit default
    const min = 10 ** (length - 1);
    const max = 10 ** length;
    return randomInt(min, max).toString();
  }
}

