import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { nanoid } from 'nanoid';

interface CreateWebhookDto {
  url: string;
  events: string[];
}

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createWebhook(clientId: string, dto: CreateWebhookDto) {
    if (!dto.url || !Array.isArray(dto.events) || dto.events.length === 0) {
      throw new BadRequestException('Invalid webhook configuration');
    }

    const client = await this.prisma.apiClient.findUnique({
      where: { id: clientId },
      select: { id: true },
    });

    if (!client) {
      throw new ForbiddenException('Client not found');
    }

    const secret = nanoid(32);

    const webhook = await this.prisma.webhook.create({
      data: {
        apiClientId: clientId,
        url: dto.url,
        secret,
        events: dto.events,
      },
    });

    await this.audit.record({
      action: 'PERMISSIONS_CHANGED', // TODO: WEBHOOK_CREATED
      entity: 'Webhook',
      entityId: webhook.id,
      metadata: { clientId, events: dto.events },
    });

    // Return secret (signing key) only once
    return {
      id: webhook.id,
      url: webhook.url,
      events: webhook.events,
      secret,
      message: 'Store secret securely. You will need it to verify incoming webhook signatures.',
    };
  }

  async deleteWebhook(clientId: string, webhookId: string) {
    const webhook = await this.prisma.webhook.findUnique({
      where: { id: webhookId },
      select: { apiClientId: true },
    });

    if (!webhook) {
      throw new NotFoundException('Webhook not found');
    }

    if (webhook.apiClientId !== clientId) {
      throw new ForbiddenException('Not authorized');
    }

    await this.prisma.webhook.delete({
      where: { id: webhookId },
    });

    await this.audit.record({
      action: 'PERMISSIONS_CHANGED',
      entity: 'Webhook',
      entityId: webhookId,
      metadata: { clientId },
    });

    return { success: true };
  }

  async getWebhooks(clientId: string) {
    return this.prisma.webhook.findMany({
      where: { apiClientId: clientId },
      select: { id: true, url: true, events: true, isActive: true, createdAt: true },
    });
  }
}
