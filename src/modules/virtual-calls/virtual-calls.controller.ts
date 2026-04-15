import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { UserRole } from '@prisma/client';
import { VirtualCallsService } from './virtual-calls.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

class CreateVirtualRoomDto {
  @IsString()
  bookingId!: string;
}

@ApiTags('virtual-calls')
@Controller('virtual-calls')
export class VirtualCallsController {
  constructor(private readonly virtualCalls: VirtualCallsService) {}

  @Post('rooms')
  @Roles(UserRole.STAFF, UserRole.MANAGER, UserRole.OWNER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a Daily.co room for a booking (staff only)' })
  async createRoom(
    @Body() dto: CreateVirtualRoomDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.virtualCalls.createVirtualRoom(dto.bookingId, user.role as UserRole);
  }
}
