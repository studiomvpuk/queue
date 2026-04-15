import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsEmail, IsOptional, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateUserDto {
  @ApiProperty({ example: 'John', required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  firstName?: string;

  @ApiProperty({ example: 'john@example.com', required: false })
  @IsOptional()
  @IsEmail()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email?: string;
}
