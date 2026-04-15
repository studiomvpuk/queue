import { Module } from '@nestjs/common';
import { SavedLocationsController } from './saved-locations.controller';
import { SavedLocationsService } from './saved-locations.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [SavedLocationsController],
  providers: [SavedLocationsService],
})
export class SavedLocationsModule {}
