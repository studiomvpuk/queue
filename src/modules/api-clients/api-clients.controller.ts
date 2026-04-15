import {
  BadRequestException,
  Body,
  Controller,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsArray, IsIn, IsString } from 'class-validator';
import { UserRole } from '@prisma/client';
import { ApiClientsService } from './api-clients.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

class CreateApiClientDto {
  @IsString()
  name!: string;

  @IsArray()
  @IsString({ each: true })
  scopes!: string[];
}

class TokenRequestDto {
  @IsString()
  @IsIn(['client_credentials'])
  grant_type!: 'client_credentials';

  @IsString()
  client_id!: string;

  @IsString()
  client_secret!: string;
}

@ApiTags('admin-api-clients')
@Controller('admin/api-clients')
export class ApiClientsController {
  constructor(private readonly apiClients: ApiClientsService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create an API client (ADMIN only). Secret is shown once.' })
  async createClient(
    @Body() dto: CreateApiClientDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.apiClients.createApiClient(user.sub, dto);
  }
}

@ApiTags('oauth')
@Controller('oauth')
export class OAuthController {
  constructor(private readonly apiClients: ApiClientsService) {}

  @Post('token')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Issue an OAuth2 client_credentials access token (30m TTL)' })
  async issueToken(@Body() dto: TokenRequestDto) {
    if (dto.grant_type !== 'client_credentials') {
      throw new BadRequestException('Only client_credentials grant type supported');
    }
    const token = await this.apiClients.issueAccessToken(dto.client_id, dto.client_secret);
    return {
      access_token: token,
      token_type: 'Bearer',
      expires_in: 1800,
    };
  }
}
