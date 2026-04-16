import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';

export enum OtpChannel {
  PHONE = 'phone',
  EMAIL = 'email',
}

export class RequestOtpDto {
  @ApiProperty({ enum: OtpChannel, example: 'email', description: 'OTP delivery channel' })
  @IsEnum(OtpChannel)
  channel!: OtpChannel;

  @ApiProperty({ example: '+2348012345678', required: false })
  @ValidateIf((o) => o.channel === OtpChannel.PHONE)
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(/^(\+234\d{10}|0\d{10})$/, { message: 'Phone must be +234XXXXXXXXXX or 0XXXXXXXXXX' })
  phone?: string;

  @ApiProperty({ example: 'user@example.com', required: false })
  @ValidateIf((o) => o.channel === OtpChannel.EMAIL)
  @IsEmail({}, { message: 'Invalid email address' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email?: string;
}
