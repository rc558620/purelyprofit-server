import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsInt } from 'class-validator';

export class ActivateStaffDto {
  @ApiProperty({ example: 1, description: '所属门店 ID' })
  @IsInt({ message: '所属门店 ID 必须是整数' })
  storeId: number;

  @ApiProperty({ example: 'staff@example.com', description: '员工登录邮箱' })
  @IsEmail({}, { message: '员工邮箱格式不正确' })
  email: string;
}
