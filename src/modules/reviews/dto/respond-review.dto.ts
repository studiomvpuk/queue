import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class RespondReviewDto {
  @ApiProperty({ example: 'Thank you for your feedback!', maxLength: 500 })
  @IsString()
  @MaxLength(500)
  response!: string;
}
