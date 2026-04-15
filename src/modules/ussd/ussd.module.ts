import { Module } from '@nestjs/common';
import { UssdService } from './ussd.service';
import { UssdController } from './ussd.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { RedisModule } from '../../common/redis/redis.module';

@Module({
  imports: [PrismaModule, RedisModule],
  providers: [UssdService],
  controllers: [UssdController],
})
export class UssdModule {}
