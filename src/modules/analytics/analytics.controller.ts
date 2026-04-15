import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags, ApiOkResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { UserRole } from '@prisma/client';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { BusinessScopeGuard } from '../../common/guards/business-scope.guard';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@Controller('locations/:locationId/analytics')
@Roles(UserRole.STAFF, UserRole.MANAGER, UserRole.OWNER)
@UseGuards(BusinessScopeGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get()
  @ApiOperation({
    summary: 'Get analytics for a location (volume, no-show rate, service times, etc.)',
  })
  @ApiOkResponse({ description: 'Analytics data for location' })
  async getLocationAnalytics(
    @Param('locationId') locationId: string,
    @Query('range') range: '7d' | '30d' = '7d',
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.analytics.getLocationAnalytics(user.sub, locationId, range);
  }

  @Get('export')
  @ApiOperation({ summary: 'Export analytics data as CSV' })
  async exportAnalytics(
    @Param('locationId') locationId: string,
    @Query('range') range: '7d' | '30d' = '30d',
    @Query('format') format: string = 'csv',
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const csv = await this.analytics.exportAnalyticsCsv(
      user.sub,
      locationId,
      range,
    );

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="analytics-${locationId}-${range}.csv"`,
    );
    res.send(csv);
  }
}
