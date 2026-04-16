import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Ip,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags, ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { UserRole } from '@prisma/client';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { BusinessScopeGuard } from '../../common/guards/business-scope.guard';
import { BusinessesService } from './businesses.service';
import { CreateBusinessDto } from './dto/create-business.dto';
import { RegisterBusinessDto } from './dto/register-business.dto';
import { InviteStaffDto } from './dto/invite-staff.dto';

@ApiTags('businesses')
@Controller('businesses')
export class BusinessesController {
  constructor(private readonly businesses: BusinessesService) {}

  /**
   * Public endpoint — no auth required.
   * Businesses register here, an account is created/promoted to OWNER,
   * and the business is put in PENDING verification state.
   */
  @Post('register')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Register a new business (public, no auth required)' })
  @ApiCreatedResponse({ description: 'Business registered, pending verification' })
  async registerBusiness(
    @Body() dto: RegisterBusinessDto,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    return this.businesses.registerBusiness(dto, ip, req.header('user-agent') || '');
  }

  @Post()
  @Roles(UserRole.OWNER)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a new business (OWNER only, authenticated)' })
  @ApiCreatedResponse({ description: 'Business' })
  async createBusiness(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBusinessDto,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    return this.businesses.createBusiness(user.sub, dto, ip, req.header('user-agent') || '');
  }

  @Get('me')
  @ApiOperation({ summary: 'Get businesses I own or manage' })
  @ApiOkResponse({ description: 'Businesses' })
  async getMyBusinesses(@CurrentUser() user: AuthenticatedUser) {
    return this.businesses.getMyBusinesses(user.sub);
  }

  @Get(':businessId/locations')
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @UseGuards(BusinessScopeGuard)
  @ApiOperation({ summary: 'Get all locations in a business (OWNER/MANAGER)' })
  @ApiOkResponse({ description: 'Locations' })
  async getBusinessLocations(
    @Param('businessId') businessId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.businesses.getBusinessLocations(user.sub, businessId);
  }

  @Get(':businessId/aggregate')
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @UseGuards(BusinessScopeGuard)
  @ApiOperation({
    summary: 'Get aggregated KPIs across business locations',
  })
  @ApiOkResponse({
    description: 'Aggregate stats: totalBookingsToday, avgWaitSeconds, topBusiestLocations',
  })
  async getBusinessAggregate(
    @Param('businessId') businessId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.businesses.getBusinessAggregate(user.sub, businessId);
  }

  @Post(':businessId/staff')
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Invite staff to location in business' })
  @ApiCreatedResponse({ description: 'StaffMembership' })
  async inviteStaff(
    @Param('businessId') businessId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InviteStaffDto,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    return this.businesses.inviteStaff(
      user.sub,
      businessId,
      dto,
      ip,
      req.header('user-agent') || '',
    );
  }
}
