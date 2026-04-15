import {
  Controller,
  Post,
  Delete,
  Get,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  Ip,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags, ApiCreatedResponse, ApiOkResponse, ApiNoContentResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { SavedLocationsService } from './saved-locations.service';
import { SaveLocationDto } from './dto/save-location.dto';

@ApiTags('saved-locations')
@Controller('saved-locations')
export class SavedLocationsController {
  constructor(private readonly savedLocations: SavedLocationsService) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Save a location (max 5 per user)' })
  @ApiCreatedResponse({ description: 'SavedLocation' })
  async saveLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SaveLocationDto,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    return this.savedLocations.saveLocation(
      user.sub,
      dto.locationId,
      ip,
      req.header('user-agent') || '',
    );
  }

  @Delete(':locationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unsave a location' })
  @ApiNoContentResponse()
  async unsaveLocation(
    @Param('locationId') locationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    return this.savedLocations.unsaveLocation(
      user.sub,
      locationId,
      ip,
      req.header('user-agent') || '',
    );
  }

  @Get('me')
  @ApiOperation({ summary: 'Get my saved locations with live queue state' })
  @ApiOkResponse({ description: 'Saved locations' })
  async getMySavedLocations(@CurrentUser() user: AuthenticatedUser) {
    return this.savedLocations.getMySavedLocations(user.sub);
  }
}
