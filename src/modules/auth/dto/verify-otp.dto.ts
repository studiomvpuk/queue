import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class VerifyOtpDto {
  @ApiProperty({ example: '+2348012345678' })
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(/^(\+234\d{10}|0\d{10})$/)
  phone!: string;

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
