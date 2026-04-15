import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  RawBodyRequest,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { Request } from 'express';
import { PaymentsService } from './payments.service';
import { InitializePaystackDto } from './dto/initialize-paystack.dto';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('paystack/initialize')
  @ApiBearerAuth()
  @ApiResponse({
    status: 200,
    description: 'Payment initialized. authorizationUrl valid for ~30 minutes.',
  })
  async initializePaystack(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InitializePaystackDto,
    @Req() req: Request,
  ) {
    return this.payments.initializePaystack(
      user.sub,
      dto,
      req.ip,
      req.header('user-agent'),
    );
  }

  @Post('paystack/webhook')
  @Public()
  @ApiResponse({ status: 200, description: 'Webhook processed' })
  async handleWebhook(
    @Headers('x-paystack-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    if (!signature) {
      throw new BadRequestException('Missing X-Paystack-Signature header');
    }
    if (!req.rawBody) {
      throw new BadRequestException('Missing raw body for HMAC verification');
    }
    await this.payments.handlePaystackWebhook(signature, req.rawBody, req.ip);
    return { received: true };
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiResponse({ status: 200, description: 'User payment history' })
  async getPaymentHistory(@CurrentUser() user: AuthenticatedUser) {
    return this.payments.getPaymentHistory(user.sub);
  }
}
