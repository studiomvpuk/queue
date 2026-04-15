import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';

export class RescheduleBookingDto {
  @ApiProperty({ example: '2026-04-15T11:30:00Z', description: 'New slot start time (ISO)' })
  @IsDateString()
  slotStart!: string;
}
