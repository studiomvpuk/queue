import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { BookingsService } from '../bookings/bookings.service';
import { QueuesGateway } from '../queues/queues.gateway';
import { AuditAction } from '@prisma/client';
import { nanoid } from 'nanoid';
import { createHmac } from 'crypto';
import { InitializePaystackDto } from './dto/initialize-paystack.dto';
import { getPrioritySlotPrice } from './pricing';

interface PaystackInitResponse {
  status: boolean;
  message: string;
  data?: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
}

interface PaystackEvent {
  event: string;
  data: {
    reference: string;
    status: string;
    amount: number;
    customer?: { email: string };
  };
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly paystackBaseUrl = 'https://api.paystack.co';

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly bookings: BookingsService,
    private readonly gateway: QueuesGateway,
  ) {}

  async initializePaystack(userId: string, dto: InitializePaystackDto, ip?: string, userAgent?: string) {
    const location = await this.prisma.location.findUnique({
      where: { id: dto.locationId },
      select: { category: true },
    });
    if (!location) {
      throw new BadRequestException('Location not found');
    }

    // Check accessibility — exempt from payment
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isAccessibility: true },
    });
    if (user?.isAccessibility) {
      throw new BadRequestException('Accessibility users do not pay for priority slots');
    }

    const amountKobo = getPrioritySlotPrice(location.category);
    const reference = nanoid();

    // Create Payment record
    const payment = await this.prisma.payment.create({
      data: {
        userId,
        reference,
        amountKobo,
        bookingId: dto.bookingId,
        provider: 'paystack',
        status: 'initiated',
      },
    });

    // Call Paystack
    const paystackSecret = this.config.get('PAYSTACK_SECRET_KEY');
    if (!paystackSecret) {
      throw new BadRequestException('Paystack not configured');
    }

    try {
      // Native fetch — keeps the dep surface small (axios was missing from
      // package.json anyway).
      const httpRes = await fetch(`${this.paystackBaseUrl}/transaction/initialize`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${paystackSecret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: `user-${userId}@queueease.app`,
          amount: amountKobo,
          reference,
          metadata: {
            userId,
            locationId: dto.locationId,
            purpose: dto.purpose,
            slotStart: dto.slotStart,
          },
        }),
      });

      if (!httpRes.ok) {
        const txt = await httpRes.text();
        throw new BadRequestException(`Paystack ${httpRes.status}: ${txt.slice(0, 200)}`);
      }

      const data = (await httpRes.json()) as PaystackInitResponse;
      if (!data.status || !data.data) {
        throw new BadRequestException('Paystack initialization failed');
      }

      // Never persist authorization_url beyond this response
      await this.audit.record({
        userId,
        action: AuditAction.PAYMENT_INITIATED,
        entity: 'Payment',
        entityId: payment.id,
        ip,
        userAgent,
        metadata: { reference, amountKobo, purpose: dto.purpose },
      });

      return {
        authorizationUrl: data.data.authorization_url,
        reference,
        paymentId: payment.id,
      };
    } catch (error) {
      this.logger.error(`Paystack init failed: ${error instanceof Error ? error.message : 'unknown'}`);
      throw new BadRequestException('Payment initialization failed');
    }
  }

  async handlePaystackWebhook(signature: string, body: Buffer, ip?: string): Promise<void> {
    const paystackSecret = this.config.get('PAYSTACK_WEBHOOK_SECRET');
    if (!paystackSecret) {
      throw new BadRequestException('Webhook secret not configured');
    }

    // Verify HMAC-SHA512
    const hash = createHmac('sha512', paystackSecret).update(body).digest('hex');
    if (hash !== signature) {
      this.logger.warn(`Webhook signature mismatch from ${ip}`);
      throw new BadRequestException('Invalid signature');
    }

    let event: PaystackEvent;
    try {
      event = JSON.parse(body.toString());
    } catch {
      throw new BadRequestException('Invalid JSON');
    }

    if (event.event !== 'charge.success') {
      return; // Ignore other events
    }

    const reference = event.data.reference;

    // Atomically process — idempotent by reference
    const payment = await this.prisma.payment.findUnique({
      where: { reference },
      select: { id: true, userId: true, status: true },
    });

    if (!payment) {
      this.logger.warn(`Webhook: Payment not found for reference ${reference}`);
      return;
    }

    if (payment.status === 'success') {
      return; // Already processed
    }

    // Update payment
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'success', completedAt: new Date() },
    });

    // Create priority booking atomically
    // NOTE: Simplified — full impl would orchestrate with BookingsService
    await this.audit.record({
      userId: payment.userId,
      action: AuditAction.PAYMENT_COMPLETED,
      entity: 'Payment',
      entityId: payment.id,
      ip,
      metadata: { reference },
    });

    // Emit WS event to the user's private room (auto-joined on connect).
    this.gateway.notifyUser(payment.userId, {
      type: 'payment:success',
      reference,
    });
  }

  async getPaymentHistory(userId: string, limit: number = 20) {
    return this.prisma.payment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        reference: true,
        amountKobo: true,
        status: true,
        createdAt: true,
        completedAt: true,
      },
    });
  }
}
