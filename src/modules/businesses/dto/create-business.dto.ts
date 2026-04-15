import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class CreateBusinessDto {
  @ApiProperty({ example: 'Acme Bank' })
  @IsString()
  name!: string;

  @ApiProperty({ example: 'acme-bank' })
  @IsString()
  slug!: string;

  @ApiProperty({ example: 'https://...', required: false })
  @IsString()
  logoUrl?: string;
}
