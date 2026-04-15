import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  Ip,
  Req,
  UseGuards,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags, ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { UserRole } from '@prisma/client';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { BusinessScopeGuard } from '../../common/guards/business-scope.guard';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { RespondReviewDto } from './dto/respond-review.dto';

@ApiTags('reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a review for a booking (SERVED status, within 7 days)' })
  @ApiCreatedResponse({ description: 'Review' })
  async createReview(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateReviewDto,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    return this.reviews.createReview(user.sub, dto, ip, req.header('user-agent') || '');
  }

  @Get('locations/:locationId')
  @Public()
  @ApiOperation({ summary: 'Get reviews for a location (paginated, excludes hidden unless STAFF)' })
  @ApiOkResponse({ description: 'Reviews list' })
  async getLocationReviews(
    @Param('locationId') locationId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const staffRoles: UserRole[] = [UserRole.STAFF, UserRole.MANAGER, UserRole.OWNER];
    const isStaff = !!user && staffRoles.includes(user.role as UserRole);

    if (isStaff) {
      // Staff of this location can see all
      return this.reviews.getLocationReviewsForStaff(
        locationId,
        cursor,
        limit ? parseInt(limit, 10) : 10,
      );
    }

    return this.reviews.getLocationReviews(
      locationId,
      cursor,
      limit ? parseInt(limit, 10) : 10,
    );
  }

  @Post(':id/respond')
  @Roles(UserRole.STAFF, UserRole.MANAGER, UserRole.OWNER)
  @UseGuards(BusinessScopeGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Add merchant reply to review (OWNER/MANAGER of location)' })
  @ApiOkResponse({ description: 'Review' })
  async respondToReview(
    @Param('id') reviewId: string,
    @Param('locationId') locationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RespondReviewDto,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    return this.reviews.respondToReview(
      reviewId,
      locationId,
      user.sub,
      dto,
      ip,
      req.header('user-agent') || '',
    );
  }
}
