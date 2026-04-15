import { Controller, Post, Get, Param, Body, HttpCode, HttpStatus, Ip, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiOkResponse, ApiCreatedResponse, ApiNoContentResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { Booking } from '@prisma/client';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { RescheduleBookingDto } from './dto/reschedule-booking.dto';
import { CreateWalkInDto } from './dto/walk-in.dto';

@ApiTags('bookings')
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a new booking (transactional)' })
  @ApiCreatedResponse({ description: 'Booking' })
  async createBooking(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBookingDto,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<Booking> {
    return this.bookings.createBooking(user.sub, dto, ip, req.header('user-agent'));
  }

  @Post('walk-in')
  @Roles(UserRole.STAFF, UserRole.MANAGER, UserRole.OWNER)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Add a walk-in customer to the queue (staff)' })
  @ApiCreatedResponse({ description: 'Booking' })
  async addWalkIn(
    @Body() dto: CreateWalkInDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<Booking> {
    return this.bookings.addWalkIn(
      dto,
      user.sub,
      user.role as UserRole,
      ip,
      req.header('user-agent'),
    );
  }

  @Get('location/:locationId/queue')
  @Roles(UserRole.STAFF, UserRole.MANAGER, UserRole.OWNER)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: "Today's bookings at a location, grouped by status (staff only)" })
  @ApiOkResponse({ description: 'upcoming / inQueue / served arrays' })
  async getLocationQueue(@Param('locationId') locationId: string) {
    return this.bookings.getLocationQueue(locationId);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get my bookings (range: active|past)' })
  @ApiOkResponse({ description: 'Bookings' })
  async getMyBookings(
    @CurrentUser() user: AuthenticatedUser,
    @Query('range') range?: 'active' | 'past',
  ) {
    return this.bookings.getMyBookings(user.sub, range);
  }

  @Post(':id/cancel')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel a booking (customer)' })
  @ApiNoContentResponse()
  async cancelBooking(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.bookings.cancelBooking(id, user.sub, ip, req.header('user-agent'));
  }

  @Post(':id/reschedule')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Reschedule a confirmed booking to a new slot' })
  @ApiOkResponse({ description: 'Booking' })
  async rescheduleBooking(
    @Param('id') id: string,
    @Body() dto: RescheduleBookingDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<Booking> {
    return this.bookings.rescheduleBooking(
      id,
      user.sub,
      dto.slotStart,
      ip,
      req.header('user-agent'),
    );
  }

  @Post(':id/arrived')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Mark booking as arrived (customer)' })
  @ApiOkResponse({ description: 'Booking' })
  async markArrived(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<Booking> {
    return this.bookings.markArrived(id, user.sub, ip, req.header('user-agent'));
  }

  @Post(':id/serve')
  @Roles(UserRole.STAFF, UserRole.MANAGER, UserRole.OWNER)
  @Throttle({ default: { limit: 100, ttl: 60_000 } })
  @ApiOperation({ summary: 'Mark booking as being served (STAFF)' })
  @ApiOkResponse({ description: 'Booking' })
  async markServing(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<Booking> {
    return this.bookings.markServing(id, user.sub, user.role as UserRole, ip, req.header('user-agent'));
  }

  @Post(':id/served')
  @Roles(UserRole.STAFF, UserRole.MANAGER, UserRole.OWNER)
  @Throttle({ default: { limit: 100, ttl: 60_000 } })
  @ApiOperation({ summary: 'Mark booking as served (STAFF)' })
  @ApiOkResponse({ description: 'Booking' })
  async markServed(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<Booking> {
    return this.bookings.markServed(id, user.sub, user.role as UserRole, ip, req.header('user-agent'));
  }

  @Post(':id/no-show')
  @Roles(UserRole.STAFF, UserRole.MANAGER, UserRole.OWNER)
  @Throttle({ default: { limit: 100, ttl: 60_000 } })
  @ApiOperation({ summary: 'Mark booking as no-show (STAFF, increments strikes)' })
  @ApiOkResponse({ description: 'Booking' })
  async markNoShow(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<Booking> {
    return this.bookings.markNoShow(id, user.sub, user.role as UserRole, ip, req.header('user-agent'));
  }

  @Get(':id/ticket')
  @ApiOperation({ summary: 'Get booking ticket state (position, ETA)' })
  @ApiOkResponse({ description: 'Ticket state with position and ETA' })
  async getTicket(@Param('id') id: string) {
    return this.bookings.getTicket(id);
  }
}
