import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { CreateJobDto } from './dto/create-job.dto';
import { ApiAcceptedResponse, ApiBadRequestResponse, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JobSnapshotDto } from './dto/job-snapshot.dto';
import { StatsResponseDto } from './dto/stats.dto';

@ApiTags('jobs')
@Controller()
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Post('jobs')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Start a new job' })
  @ApiBody({ description: 'Create job payload', type: CreateJobDto })
  @ApiAcceptedResponse({ description: 'Job accepted and started', type: JobSnapshotDto })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  create(@Body() dto: CreateJobDto): JobSnapshotDto {
    return this.jobs.createJob(dto) as any;
  }

  @Get('jobs')
  @ApiOperation({ summary: 'List all jobs' })
  @ApiOkResponse({ description: 'Array of jobs with current status and history', type: JobSnapshotDto, isArray: true })
  list(): JobSnapshotDto[] {
    return this.jobs.getAllJobs() as any;
  }

  @Get('stats')
  @ApiOperation({ summary: 'Generate analytics and correlations for job outcomes' })
  @ApiOkResponse({ description: 'Aggregated statistics and correlation patterns', type: StatsResponseDto })
  stats(): StatsResponseDto {
    return this.jobs.getStats() as any;
  }
}
