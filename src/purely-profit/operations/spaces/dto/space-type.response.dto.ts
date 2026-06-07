import { ApiProperty } from '@nestjs/swagger';

export class SpaceTypeResponseDto {
  @ApiProperty({ example: '1', description: '空间类型 ID' })
  id: string;

  @ApiProperty({ example: '包间', description: '空间类型名称' })
  name: string;

  @ApiProperty({ example: 1715600000000, description: '创建时间戳（毫秒）' })
  createdAt: number;

  @ApiProperty({ example: 1715603600000, description: '更新时间戳（毫秒）' })
  updatedAt: number;
}
