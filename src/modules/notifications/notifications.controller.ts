import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiOkResponse } from '@nestjs/swagger';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get my notification history (paginated)' })
  @ApiOkResponse({ description: 'List of notifications for the current user' })
  async getMyNotifications(
    @CurrentUser() user: AuthenticatedUser,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const notifications = await this.prisma.notification.findMany({
      where: {
        booking: {
          userId: user.sub,
        },
      },
      take: limit ? parseInt(limit, 10) : 10,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { createdAt: 'desc' },
      include: { booking: { select: { code: true } } },
    });

    return notifications;
  }
}
