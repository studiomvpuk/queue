import { Module } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { WebhooksController } from './webhooks.controller';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { AuditModule } from '../../common/audit/audit.module';

@Module({
  imports: [AuditModule],
  providers: [WebhooksService, WebhookDispatcherService],
  controllers: [WebhooksController],
  exports: [WebhookDispatcherService],
})
export class WebhooksModule {}
