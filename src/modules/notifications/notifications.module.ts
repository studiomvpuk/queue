import { Module } from '@nestjs/common';
import { PushModule } from './push/push.module';
import { SmsModule } from './sms/sms.module';
import { TierSchedulerService } from './tier-scheduler.service';
import { NotificationsController } from './notifications.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';

@Module({
  imports: [PushModule, SmsModule, PrismaModule],
  controllers: [NotificationsController],
  providers: [TierSchedulerService],
  exports: [PushModule, SmsModule],
})
export class NotificationsModule {}
