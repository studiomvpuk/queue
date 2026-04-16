import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { WebhooksService } from './webhooks.service';
import { WebhooksController } from './webhooks.controller';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { AuditModule } from '../../common/audit/audit.module';
import { ApiClientAuthGuard } from '../api-clients/api-client-auth.guard';

@Module({
  imports: [AuditModule, JwtModule.register({})],
  providers: [WebhooksService, WebhookDispatcherService, ApiClientAuthGuard],
  controllers: [WebhooksController],
  exports: [WebhookDispatcherService],
})
export class WebhooksModule {}
