import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';

interface WebhookPayload {
  event: string;
  data: unknown;
  timestamp: string;
}

/**
 * Webhook dispatcher — PRD §3.3.
 *
 * Fan-out for booking lifecycle events to subscribed clients.
 *
 * Original scaffold used BullMQ; we replaced that with an in-process retry
 * loop with exponential backoff to remove the unmaintained bull/@nestjs/bull
 * dependencies. Three attempts (2s, 4s, 8s) — fire-and-forget so callers
 * are never blocked on network latency to a slow subscriber.
 *
 * Each attempt's outcome is persisted on the Webhook row via lastFireAt /
 * lastError so admins can debug from the dashboard.
 */
@Injectable()
export class WebhookDispatcherService {
  private readonly logger = new Logger(WebhookDispatcherService.name);
  private readonly maxAttempts = 3;
  private readonly baseDelayMs = 2000;
  private readonly timeoutMs = 10_000;

  constructor(private readonly prisma: PrismaService) {}

  async dispatchWebhook(event: string, data: unknown): Promise<void> {
    const webhooks = await this.prisma.webhook.findMany({
      where: {
        isActive: true,
        events: { has: event },
      },
      select: { id: true, url: true, secret: true },
    });

    const payload: WebhookPayload = {
      event,
      data,
      timestamp: new Date().toISOString(),
    };

    // Fan out without awaiting — caller (booking flow) shouldn't block on
    // slow subscribers.
    for (const webhook of webhooks) {
      void this.deliverWithRetry(webhook.id, webhook.url, webhook.secret, payload);
    }
  }

  private async deliverWithRetry(
    webhookId: string,
    url: string,
    secret: string,
    payload: WebhookPayload,
  ): Promise<void> {
    const signature = this.signPayload(payload, secret);

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-QueueEase-Signature': signature,
            'X-QueueEase-Timestamp': payload.timestamp,
            'X-QueueEase-Attempt': String(attempt),
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        }).finally(() => clearTimeout(timer));

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        await this.prisma.webhook.update({
          where: { id: webhookId },
          data: { lastFireAt: new Date(), lastError: null },
        });
        this.logger.debug(`Webhook ${webhookId} delivered (attempt ${attempt})`);
        return;
      } catch (err) {
        const message = (err as Error).message;
        this.logger.warn(`Webhook ${webhookId} attempt ${attempt} failed: ${message}`);

        if (attempt === this.maxAttempts) {
          await this.prisma.webhook
            .update({
              where: { id: webhookId },
              data: { lastFireAt: new Date(), lastError: message },
            })
            .catch(() => {});
          return;
        }

        await new Promise((r) =>
          setTimeout(r, this.baseDelayMs * Math.pow(2, attempt - 1)),
        );
      }
    }
  }

  private signPayload(payload: WebhookPayload, secret: string): string {
    const json = JSON.stringify(payload);
    return createHmac('sha256', secret).update(json).digest('hex');
  }
}
