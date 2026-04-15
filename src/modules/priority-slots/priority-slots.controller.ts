import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUrl } from 'class-validator';
import { Request } from 'express';
import { PrioritySlotsService } from './priority-slots.service';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

class SetAccessibilityDto {
  @IsBoolean()
  isAccessibility!: boolean;

  @IsOptional()
  @IsUrl()
  proofDocumentUrl?: string;
}

@ApiTags('priority-slots')
@Controller('users/me')
export class PrioritySlotsController {
  constructor(private readonly prioritySlots: PrioritySlotsService) {}

  @Post('accessibility')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Declare accessibility status (free priority slots)' })
  async setAccessibility(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SetAccessibilityDto,
    @Req() req: Request,
  ) {
    return this.prioritySlots.setAccessibility(
      user.sub,
      dto.isAccessibility,
      dto.proofDocumentUrl,
      req.ip,
      req.header('user-agent'),
    );
  }
}
