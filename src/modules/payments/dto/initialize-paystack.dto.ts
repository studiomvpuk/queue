import { IsString, IsOptional, IsDateString, IsIn } from 'class-validator';

export class InitializePaystackDto {
  @IsOptional()
  @IsString()
  bookingId?: string;

  @IsString()
  @IsIn(['PRIORITY_SLOT'])
  purpose!: 'PRIORITY_SLOT';

  @IsString()
  locationId!: string;

  @IsDateString()
  slotStart!: string; // ISO datetime
}
