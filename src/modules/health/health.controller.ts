import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

@ApiTags('health')
@Controller({ path: 'health', version: undefined })
export class HealthController {
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}

  @Public()
  @Get()
  async check() {
    const started = Date.now();
    const [db, cache] = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.redis.client.ping(),
    ]);
    return {
      status: db.status === 'fulfilled' && cache.status === 'fulfilled' ? 'ok' : 'degraded',
      db: db.status,
      redis: cache.status,
      uptimeSec: Math.round(process.uptime()),
      latencyMs: Date.now() - started,
      version: process.env.npm_package_version ?? '0.0.0',
    };
  }
}
