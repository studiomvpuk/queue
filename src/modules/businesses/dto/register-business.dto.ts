import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  MinLength,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export enum BusinessSize {
  INDIVIDUAL = 'INDIVIDUAL',
  SME = 'SME',
  ENTERPRISE = 'ENTERPRISE',
}

export enum BusinessType {
  SOLE_PROPRIETORSHIP = 'SOLE_PROPRIETORSHIP',
  PARTNERSHIP = 'PARTNERSHIP',
  LIMITED_LIABILITY = 'LIMITED_LIABILITY',
  NGO = 'NGO',
  GOVERNMENT = 'GOVERNMENT',
  HOSPITAL = 'HOSPITAL',
  EDUCATIONAL = 'EDUCATIONAL',
  OTHER = 'OTHER',
}

export enum BusinessCategory {
  BANK = 'BANK',
  HOSPITAL = 'HOSPITAL',
  GOVERNMENT = 'GOVERNMENT',
  SALON = 'SALON',
  TELECOM = 'TELECOM',
  OTHER = 'OTHER',
}

export class RegisterBusinessDto {
  // ── Always required ──

  @ApiProperty({ example: 'tolu@acmehospital.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'StrongP@ss1' })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password!: string;

  @ApiProperty({ example: 'Acme Hospital' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  businessName!: string;

  @ApiProperty({ enum: BusinessSize, example: BusinessSize.SME })
  @IsEnum(BusinessSize)
  size!: BusinessSize;

  // ── SME / Enterprise only ──

  @ApiPropertyOptional({ enum: BusinessType, example: BusinessType.LIMITED_LIABILITY })
  @ValidateIf((o) => o.size !== BusinessSize.INDIVIDUAL)
  @IsEnum(BusinessType, { message: 'Please select a business type' })
  type?: BusinessType;

  @ApiPropertyOptional({ enum: BusinessCategory, example: BusinessCategory.HOSPITAL })
  @ValidateIf((o) => o.size !== BusinessSize.INDIVIDUAL)
  @IsEnum(BusinessCategory, { message: 'Please select an industry' })
  category?: BusinessCategory;

  @ApiPropertyOptional({ example: 'RC-123456' })
  @ValidateIf((o) => o.size !== BusinessSize.INDIVIDUAL)
  @IsNotEmpty({ message: 'CAC Registration Number is required for SME and Enterprise businesses' })
  @IsString()
  @MinLength(3, { message: 'CAC Registration Number must be at least 3 characters' })
  cacNumber?: string;
}
