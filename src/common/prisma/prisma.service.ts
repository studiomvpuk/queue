import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * PrismaService — owns the singleton Prisma client for the app.
 *
 * - Connects on module init, disconnects on shutdown
 * - Soft-delete aware queries should use `where: { deletedAt: null }` at the repo layer
 * - Transactions use `prisma.$transaction` — see BookingsService for examples
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
      errorFormat: 'minimal',
    });

    // @ts-expect-error typed Prisma events
    this.$on('warn', (e) => this.logger.warn(e));
    // @ts-expect-error typed Prisma events
    this.$on('error', (e) => this.logger.error(e));
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
