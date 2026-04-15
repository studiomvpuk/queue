import {
  Controller,
  Post,
  Headers,
  RawBodyRequest,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiResponse } from '@nestjs/swagger';
import { UssdService } from './ussd.service';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('USSD')
@Controller('ussd')
export class UssdController {
  constructor(private readonly ussd: UssdService) {}

  @Post('termii')
  @Public()
  @ApiResponse({ status: 200, description: 'USSD menu response (plain text)' })
  async handleTermiiWebhook(
    @Headers('x-termii-signature') signature: string,
    @Req() req: RawBodyRequest<any>,
  ): Promise<{ message: string }> {
    if (!signature) {
      throw new BadRequestException('Missing signature');
    }

    const response = await this.ussd.handleTermiiWebhook(signature, req.rawBody);
    return { message: response };
  }
}
