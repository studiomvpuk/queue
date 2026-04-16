import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  MinLength,
  MaxLength,
  IsUrl,
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
  // ── Business Info ──
  @ApiProperty({ example: 'Acme Hospital' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: BusinessSize, example: BusinessSize.SME })
  @IsEnum(BusinessSize)
  size!: BusinessSize;

  @ApiProperty({ enum: BusinessType, example: BusinessType.LIMITED_LIABILITY })
  @IsEnum(BusinessType)
  type!: BusinessType;

  @ApiProperty({ enum: BusinessCategory, example: BusinessCategory.HOSPITAL })
  @IsEnum(BusinessCategory)
  category!: BusinessCategory;

  @ApiPropertyOptional({ example: 'Leading healthcare provider in Lagos' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  // ── Legal / Verification ──
  // CAC number is required for SME and ENTERPRISE
  @ApiPropertyOptional({ example: 'RC-123456' })
  @ValidateIf((o) => o.size !== BusinessSize.INDIVIDUAL)
  @IsNotEmpty({ message: 'CAC Registration Number is required for SME and Enterprise businesses' })
  @IsString()
  @MinLength(3, { message: 'CAC Registration Number must be at least 3 characters' })
  cacNumber?: string;

  @ApiPropertyOptional({ example: '12345678-0001' })
  @IsOptional()
  @IsString()
  tinNumber?: string;

  // ── Contact Person ──
  @ApiProperty({ example: 'Tolu' })
  @IsString()
  @MinLength(2)
  contactFirstName!: string;

  @ApiProperty({ example: 'Adeyemi' })
  @IsString()
  @MinLength(2)
  contactLastName!: string;

  @ApiProperty({ example: 'tolu@acmehospital.com' })
  @IsEmail()
  contactEmail!: string;

  @ApiProperty({ example: '+2348012345678' })
  @IsString()
  @MinLength(10)
  contactPhone!: string;

  @ApiPropertyOptional({ example: 'CEO' })
  @IsOptional()
  @IsString()
  contactRole?: string;

  // ── Business Contact ──
  @ApiPropertyOptional({ example: 'info@acmehospital.com' })
  @IsOptional()
  @IsEmail()
  businessEmail?: string;

  @ApiPropertyOptional({ example: '+2341234567' })
  @IsOptional()
  @IsString()
  businessPhone?: string;

  @ApiPropertyOptional({ example: 'https://acmehospital.com' })
  @IsOptional()
  @IsUrl()
  website?: string;

  // ── Address ──
  @ApiPropertyOptional({ example: '12 Marina Road' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 'Lagos' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'Lagos' })
  @IsOptional()
  @IsString()
  state?: string;
}
