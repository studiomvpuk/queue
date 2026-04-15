import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../common/redis/redis.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { createHmac } from 'crypto';

interface TermiiWebhookPayload {
  phoneNumber: string;
  sessionId: string;
  input: string;
  state: string; // USSD menu level state
}

interface USSDState {
  step: 'category' | 'location' | 'slot' | 'confirm';
  selectedCategory?: string;
  selectedLocationId?: string;
  selectedSlot?: string;
}

/**
 * USSD state machine for feature-flagged USSD flow.
 * State stored in Redis, TTL 5 minutes.
 */
@Injectable()
export class UssdService {
  private readonly logger = new Logger(UssdService.name);
  private readonly enabled: boolean;
  private readonly redisKeyPrefix = 'ussd:';
  private readonly stateTtl = 300; // 5 minutes

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {
    this.enabled = this.config.get('USSD_ENABLED') === true;
  }

  async handleTermiiWebhook(signature: string, body: Buffer): Promise<string> {
    if (!this.enabled) {
      throw new BadRequestException('USSD not enabled');
    }

    // Verify signature (Termii HMAC)
    // NOTE: Termii signature scheme varies; adapt as needed
    // This is a placeholder

    let payload: TermiiWebhookPayload;
    try {
      payload = JSON.parse(body.toString());
    } catch {
      throw new BadRequestException('Invalid JSON');
    }

    const stateKey = `${this.redisKeyPrefix}${payload.phoneNumber}`;
    let state =
      (await this.redis.getJson<USSDState>(stateKey)) ?? ({ step: 'category' } as USSDState);

    let response: string;

    switch (state.step) {
      case 'category':
        response = this.renderCategoryMenu();
        state.step = 'location';
        state.selectedCategory = payload.input;
        break;

      case 'location':
        response = await this.renderLocationMenu(state.selectedCategory);
        state.step = 'slot';
        state.selectedLocationId = payload.input;
        break;

      case 'slot':
        response = await this.renderSlotMenu(state.selectedLocationId);
        state.step = 'confirm';
        state.selectedSlot = payload.input;
        break;

      case 'confirm':
        // TODO: Create booking, return confirmation
        response = 'CON Booking confirmed! You will receive a booking code via SMS.';
        state = { step: 'category' }; // Reset
        break;

      default:
        response = this.renderCategoryMenu();
        state = { step: 'category' };
    }

    // Persist state for 5 minutes
    await this.redis.setJson(stateKey, state, this.stateTtl);

    return response;
  }

  private renderCategoryMenu(): string {
    return `CON Welcome to QueueEase
1. Bank
2. Hospital
3. Government
4. Salon
5. Telecom
6. Other`;
  }

  private async renderLocationMenu(category?: string): Promise<string> {
    if (!category) {
      return this.renderCategoryMenu();
    }

    // Fetch locations for category (simplified)
    const locations = await this.prisma.location.findMany({
      where: { category: category as any },
      take: 5,
      select: { id: true, name: true },
    });

    let menu = `CON Select Location:\n`;
    locations.forEach((loc, i) => {
      menu += `${i + 1}. ${loc.name}\n`;
    });

    return menu;
  }

  private async renderSlotMenu(locationId?: string): Promise<string> {
    if (!locationId) {
      return this.renderCategoryMenu();
    }

    // Fetch available slots for location (simplified)
    const slots = await this.prisma.booking.findMany({
      where: { locationId, status: 'PENDING' },
      take: 5,
      select: { slotStart: true, code: true },
    });

    let menu = `CON Select Slot:\n`;
    slots.forEach((slot, i) => {
      const time = new Date(slot.slotStart).toLocaleTimeString('en-NG');
      menu += `${i + 1}. ${time}\n`;
    });

    return menu;
  }
}
