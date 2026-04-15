import { Module } from '@nestjs/common';
import { BusinessesController } from './businesses.controller';
import { BusinessesService } from './businesses.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [BusinessesController],
  providers: [BusinessesService],
})
export class BusinessesModule {}
