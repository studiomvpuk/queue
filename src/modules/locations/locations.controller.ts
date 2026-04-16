import { Controller, Get, Post, Patch, Param, Body, Query, HttpCode, HttpStatus, Ip, Req } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiOkResponse, ApiCreatedResponse, ApiQuery } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import type { Location } from '@prisma/client';
import { LocationCategory } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { LocationsService } from './locations.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { AttachStaffDto } from './dto/attach-staff.dto';

@ApiTags('locations')
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List locations with filters and cursor pagination' })
  @ApiQuery({ name: 'category', enum: LocationCategory, required: false })
  @ApiQuery({ name: 'nearLat', type: Number, required: false })
  @ApiQuery({ name: 'nearLng', type: Number, required: false })
  @ApiQuery({ name: 'radiusKm', type: Number, required: false })
  @ApiQuery({ name: 'search', type: String, required: false })
  @ApiQuery({ name: 'cursor', type: String, required: false })
  @ApiQuery({ name: 'limit', type: Number, required: false })
  @ApiOkResponse({ description: 'List of locations with queue stats' })
  async list(
    @Query('category') category?: LocationCategory,
    @Query('nearLat') nearLat?: string,
    @Query('nearLng') nearLng?: string,
    @Query('radiusKm') radiusKm?: string,
    @Query('search') search?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.locations.list(
      category,
      nearLat ? parseFloat(nearLat) : undefined,
      nearLng ? parseFloat(nearLng) : undefined,
      radiusKm ? parseFloat(radiusKm) : undefined,
      search,
      cursor,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get location by ID' })
  @ApiOkResponse({ description: 'Location with queue stats' })
  async getById(@Param('id') id: string) {
    return this.locations.getById(id);
  }

  @Post()
  @Roles(UserRole.OWNER)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a new location (OWNER only)' })
  @ApiCreatedResponse({ description: 'Location' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateLocationDto,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<Location> {
    return this.locations.create(user.sub, dto, ip, req.header('user-agent'));
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Update location (OWNER/MANAGER only)' })
  @ApiOkResponse({ description: 'Location' })
  async update(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateLocationDto,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<Location> {
    return this.locations.update(id, user.sub, user.role as UserRole, dto, ip, req.header('user-agent'));
  }

  @Post(':id/staff')
  @Roles(UserRole.OWNER)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Attach staff member (OWNER only)' })
  async attachStaff(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AttachStaffDto,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.locations.attachStaff(id, user.sub, user.role as UserRole, dto, ip, req.header('user-agent'));
  }
}
