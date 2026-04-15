import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsPhoneNumber } from 'class-validator';
import { UserRole } from '@prisma/client';

export class InviteStaffDto {
  @ApiProperty({ example: '+234801234567' })
  @IsString()
  @IsPhoneNumber('NG') // Nigeria phone validation; adjust as needed
  phone!: string;

  @ApiProperty({ example: 'location-id' })
  @IsString()
  locationId!: string;

  @ApiProperty({ enum: [UserRole.STAFF, UserRole.MANAGER], example: UserRole.STAFF })
  @IsString()
  role!: UserRole;
}
