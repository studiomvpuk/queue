import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsDateString } from 'class-validator';

export class CreateBookingDto {
  @ApiProperty({ example: 'location-id' })
  @IsString()
  locationId!: string;

  @ApiProperty({ example: '2026-04-15T10:00:00Z' })
  @IsDateString()
  slotStart!: string;
}
