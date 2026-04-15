import { Module } from '@nestjs/common';
import { PrioritySlotsService } from './priority-slots.service';
import { PrioritySlotsController } from './priority-slots.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';

@Module({
  imports: [PrismaModule, AuditModule],
  providers: [PrioritySlotsService],
  controllers: [PrioritySlotsController],
  exports: [PrioritySlotsService],
})
export class PrioritySlotsModule {}
