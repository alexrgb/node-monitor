import { ApiProperty } from '@nestjs/swagger';

export class JobAttemptDto {
  @ApiProperty()
  attempt!: number;

  @ApiProperty({ required: false, nullable: true })
  pid?: number;

  @ApiProperty()
  startedAt!: number; // epoch ms

  @ApiProperty({ required: false, nullable: true })
  finishedAt?: number; // epoch ms

  @ApiProperty({ required: false, nullable: true })
  exitCode?: number | null;

  @ApiProperty({ required: false, nullable: true })
  signal?: string | null;
}
