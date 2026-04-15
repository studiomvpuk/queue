import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class SaveLocationDto {
  @ApiProperty({ example: 'location-id' })
  @IsString()
  locationId!: string;
}
