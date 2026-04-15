import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [LocationsController],
  providers: [LocationsService],
  exports: [LocationsService],
})
export class LocationsModule {}
