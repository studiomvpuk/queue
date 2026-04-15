import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ApiClientsService } from './api-clients.service';
import { ApiClientsController, OAuthController } from './api-clients.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    JwtModule.register({}),
  ],
  providers: [ApiClientsService],
  controllers: [ApiClientsController, OAuthController],
  exports: [ApiClientsService],
})
export class ApiClientsModule {}
