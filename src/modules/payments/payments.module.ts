import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';
import { BookingsModule } from '../bookings/bookings.module';
import { QueuesModule } from '../queues/queues.module';

@Module({
  imports: [PrismaModule, AuditModule, BookingsModule, QueuesModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
