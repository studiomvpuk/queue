import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsIn } from 'class-validator';

export class RegisterPushTokenDto {
  @ApiProperty({ example: 'ExponentPushToken[...]', description: 'Expo push token' })
  @IsString()
  token!: string;

  @ApiProperty({ example: 'ios', enum: ['ios', 'android', 'web'] })
  @IsIn(['ios', 'android', 'web'])
  platform!: string;
}
