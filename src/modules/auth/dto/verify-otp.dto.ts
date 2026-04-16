import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, Length, Matches, MaxLength, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import { OtpChannel } from './request-otp.dto';

export class VerifyOtpDto {
  @ApiProperty({ enum: OtpChannel, example: 'email' })
  @IsEnum(OtpChannel)
  channel!: OtpChannel;

  @ApiProperty({ example: '+2348012345678', required: false })
  @ValidateIf((o) => o.channel === OtpChannel.PHONE)
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(/^(\+234\d{10}|0\d{10})$/)
  phone?: string;

  @ApiProperty({ example: 'user@example.com', required: false })
  @ValidateIf((o) => o.channel === OtpChannel.EMAIL)
  @IsEmail()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email?: string;

  @ApiProperty({ example: '482910', minLength: 4, maxLength: 8 })
  @IsString()
  @Length(4, 8)
  @Matches(/^\d+$/, { message: 'OTP must be digits only' })
  otp!: string;

  @ApiProperty({ required: false, example: 'Tolu', description: 'Required on first-time sign-up only' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  firstName?: string;
}
