import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsEnum, IsNumber, IsInt, Min, Max, IsOptional, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { LocationCategory } from '@prisma/client';

export class CreateLocationDto {
  @ApiProperty({ example: 'Zenith Ikeja' })
  @IsString()
  @MinLength(1)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name!: string;

  @ApiProperty({ enum: LocationCategory, example: LocationCategory.BANK })
  @IsEnum(LocationCategory)
  category!: LocationCategory;

  @ApiProperty({ example: '123 Lekki Road, Lagos' })
  @IsString()
  @MinLength(1)
  address!: string;

  @ApiProperty({ example: 'Lagos' })
  @IsString()
  @MinLength(1)
  city!: string;

  @ApiProperty({ example: 'Lagos' })
  @IsString()
  @MinLength(1)
  state!: string;

  @ApiProperty({ example: 6.5244, description: 'Latitude' })
  @IsNumber()
  @Transform(({ value }) => (typeof value === 'string' ? parseFloat(value) : value))
  latitude!: number;

  @ApiProperty({ example: 3.3792, description: 'Longitude' })
  @IsNumber()
  @Transform(({ value }) => (typeof value === 'string' ? parseFloat(value) : value))
  longitude!: number;

  @ApiProperty({ example: 15, required: false })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(120)
  @Transform(({ value }) => (typeof value === 'string' ? parseInt(value, 10) : value))
  slotDurationMin?: number;

  @ApiProperty({ example: 50, required: false })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(500)
  @Transform(({ value }) => (typeof value === 'string' ? parseInt(value, 10) : value))
  maxQueueSize?: number;

  @ApiProperty({ example: 30, required: false, description: 'Walk-in percentage (0-100)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  @Transform(({ value }) => (typeof value === 'string' ? parseInt(value, 10) : value))
  walkInPercent?: number;
}
