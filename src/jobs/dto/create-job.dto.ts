import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateJobDto {
  @ApiProperty({ description: 'Unique job name', example: 'transcode-vid-001' })
  @IsString()
  @IsNotEmpty()
  jobName!: string;

  @ApiProperty({ description: 'Key=value argument list', required: false, type: [String], example: ['codec=h264','res=1080p','duration=40','bitrate=3000','priority=normal'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  arguments?: string[];
}
