import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsArray, IsString, IsUrl } from 'class-validator';
import { Request } from 'express';
import { WebhooksService } from './webhooks.service';
import { ApiClientAuthGuard } from '../api-clients/api-client-auth.guard';

class CreateWebhookDto {
  @IsUrl()
  url!: string;

  @IsArray()
  @IsString({ each: true })
  events!: string[];
}

interface ApiClientRequest extends Request {
  client?: { clientId: string; scopes: string[] };
}

@ApiTags('webhooks')
@Controller('webhooks')
@UseGuards(ApiClientAuthGuard)
@ApiBearerAuth()
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post()
  @ApiOperation({ summary: 'Subscribe a URL to one or more events' })
  async createWebhook(@Body() dto: CreateWebhookDto, @Req() req: ApiClientRequest) {
    if (!req.client) throw new BadRequestException('Client auth required');
    return this.webhooks.createWebhook(req.client.clientId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a webhook subscription' })
  async deleteWebhook(@Param('id') id: string, @Req() req: ApiClientRequest) {
    if (!req.client) throw new BadRequestException('Client auth required');
    return this.webhooks.deleteWebhook(req.client.clientId, id);
  }

  @Get('me')
  @ApiOperation({ summary: 'List my webhook subscriptions' })
  async getWebhooks(@Req() req: ApiClientRequest) {
    if (!req.client) throw new BadRequestException('Client auth required');
    return this.webhooks.getWebhooks(req.client.clientId);
  }
}
