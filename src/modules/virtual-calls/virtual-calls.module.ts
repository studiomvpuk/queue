import { Module } from '@nestjs/common';
import { VirtualCallsService } from './virtual-calls.service';
import { VirtualCallsController } from './virtual-calls.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { QueuesModule } from '../queues/queues.module';

@Module({
  imports: [PrismaModule, QueuesModule],
  providers: [VirtualCallsService],
  controllers: [VirtualCallsController],
  exports: [VirtualCallsService],
})
export class VirtualCallsModule {}
