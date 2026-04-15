import { Controller, Get, Patch, Delete, Post, Body, HttpCode, HttpStatus, Ip, Req } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiOkResponse, ApiNoContentResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { User } from '@prisma/client';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { RegisterPushTokenDto } from './dto/push-token.dto';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiOkResponse({ description: 'User' })
  async getMe(@CurrentUser() user: AuthenticatedUser): Promise<User> {
    return this.users.getMe(user.sub);
  }

  @Patch('me')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Update current user profile' })
  @ApiOkResponse({ description: 'User' })
  async updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateUserDto,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<User> {
    return this.users.updateMe(user.sub, dto, ip, req.header('user-agent'));
  }

  @Delete('me')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete current user account' })
  @ApiNoContentResponse()
  async deleteMe(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.users.softDeleteMe(user.sub, ip, req.header('user-agent'));
  }

  @Post('me/push-token')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Register Expo push token for notifications' })
  @ApiNoContentResponse()
  async registerPushToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterPushTokenDto,
  ): Promise<void> {
    return this.users.registerPushToken(user.sub, dto);
  }
}
