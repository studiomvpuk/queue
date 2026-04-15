import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsEnum } from 'class-validator';
import { UserRole } from '@prisma/client';

export class AttachStaffDto {
  @ApiProperty({ example: '+2348012345678' })
  @IsString()
  phone!: string;

  @ApiProperty({ enum: UserRole, example: UserRole.STAFF })
  @IsEnum(UserRole)
  role!: UserRole;
}
