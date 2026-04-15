import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, MaxLength, Matches } from 'class-validator';

export class CreateWalkInDto {
  @ApiProperty({ example: 'cuid-of-location' })
  @IsString()
  locationId!: string;

  @ApiProperty({ example: 'Tolu', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @ApiProperty({ example: '+2348012345678', required: false })
  @IsOptional()
  @IsString()
  @Matches(/^(\+234\d{10}|0\d{10})$/)
  phone?: string;

  @ApiProperty({
    example: false,
    required: false,
    description: 'Override the walk-in capacity reserve (PRD §1.10)',
  })
  @IsOptional()
  @IsBoolean()
  override?: boolean;
}
