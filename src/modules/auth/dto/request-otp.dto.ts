import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * E.164 Nigeria: +234... — accept +234XXXXXXXXXX (13 chars total) or local 0XXXXXXXXXX.
 * Service layer normalises to E.164 before persisting.
 */
export class RequestOtpDto {
  @ApiProperty({ example: '+2348012345678', description: 'E.164 or local Nigerian phone' })
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(/^(\+234\d{10}|0\d{10})$/, { message: 'Phone must be +234XXXXXXXXXX or 0XXXXXXXXXX' })
  phone!: string;
}
