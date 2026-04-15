import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsInt, Min, Max, IsOptional, MaxLength } from 'class-validator';

export class CreateReviewDto {
  @ApiProperty({ example: 'booking-id' })
  @IsString()
  bookingId!: string;

  @ApiProperty({ example: 5, description: 'Rating from 1 to 5' })
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiProperty({ example: 'Great service!', required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
