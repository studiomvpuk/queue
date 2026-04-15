import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsInt, Min, Max, IsOptional, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateLocationDto {
  @ApiProperty({ example: 'Zenith Ikeja', required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name?: string;

  @ApiProperty({ example: '123 Lekki Road, Lagos', required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  address?: string;

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

  @ApiProperty({ example: 30, required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  @Transform(({ value }) => (typeof value === 'string' ? parseInt(value, 10) : value))
  walkInPercent?: number;
}
