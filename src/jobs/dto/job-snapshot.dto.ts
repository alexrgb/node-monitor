import { ApiProperty } from '@nestjs/swagger';
import { JobAttemptDto } from './job-attempt.dto';

export class JobSnapshotDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  jobName!: string;

  @ApiProperty({ type: [String] })
  arguments!: string[];

  @ApiProperty({ enum: ['queued','running','succeeded','failed','crashed','retried'] })
  status!: 'queued' | 'running' | 'succeeded' | 'failed' | 'crashed' | 'retried';

  @ApiProperty()
  attempts!: number;

  @ApiProperty({ description: 'epoch ms' })
  createdAt!: number;

  @ApiProperty({ description: 'epoch ms' })
  updatedAt!: number;

  @ApiProperty({ required: false, nullable: true })
  startedAt?: number;

  @ApiProperty({ required: false, nullable: true })
  finishedAt?: number;

  @ApiProperty({ required: false, nullable: true })
  lastExitCode?: number | null;

  @ApiProperty({ type: [JobAttemptDto] })
  history!: JobAttemptDto[];
}
