import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';

import { envValidation } from './config/env.validation';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { AuditModule } from './common/audit/audit.module';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { LocationsModule } from './modules/locations/locations.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { QueuesModule } from './modules/queues/queues.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { BusinessesModule } from './modules/businesses/businesses.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { SavedLocationsModule } from './modules/saved-locations/saved-locations.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PrioritySlotsModule } from './modules/priority-slots/priority-slots.module';
import { VirtualCallsModule } from './modules/virtual-calls/virtual-calls.module';
import { ApiClientsModule } from './modules/api-clients/api-clients.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { UssdModule } from './modules/ussd/ussd.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: envValidation,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        transport:
          process.env.NODE_ENV === 'development'
            ? { target: 'pino-pretty', options: { singleLine: true, colorize: true } }
            : undefined,
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body.otp',
            'req.body.password',
            'req.body.refreshToken',
            'res.headers["set-cookie"]',
          ],
          remove: true,
        },
        customProps: (req: any) => ({ requestId: req.id }),
      },
    }),
    // Global rate limit — per-route limits override via @Throttle()
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: Number(process.env.THROTTLE_TTL_SECONDS ?? 60) * 1000,
        limit: Number(process.env.THROTTLE_LIMIT ?? 120),
      },
    ]),
    ScheduleModule.forRoot(),

    // Shared infrastructure
    PrismaModule,
    RedisModule,
    AuditModule,

    // Feature modules (Phase 1)
    HealthModule,
    AuthModule,
    UsersModule,
    LocationsModule,
    BookingsModule,
    QueuesModule,
    NotificationsModule,

    // Feature modules (Phase 2)
    ReviewsModule,
    BusinessesModule,
    AnalyticsModule,
    SavedLocationsModule,

    // Feature modules (Phase 3)
    PaymentsModule,
    PrioritySlotsModule,
    VirtualCallsModule,
    ApiClientsModule,
    WebhooksModule,
    UssdModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
  ],
})
export class AppModule {}
