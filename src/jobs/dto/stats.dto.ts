import { ApiProperty } from '@nestjs/swagger';

export class StatsPatternDto {
  @ApiProperty()
  pattern!: string;

  @ApiProperty()
  matchCount!: number;

  @ApiProperty({ description: '0..1 success rate rounded to 2 decimals' })
  successRate!: number;

  @ApiProperty({ description: 'Difference from overall success rate, formatted +/-XX%' })
  differenceFromAverage!: string;

  @ApiProperty({ description: 'Short human insight' })
  insight!: string;
}

export class StatsResponseDto {
  @ApiProperty()
  domain!: string;

  @ApiProperty()
  totalJobs!: number;

  @ApiProperty()
  overallSuccessRate!: number;

  @ApiProperty({ type: [StatsPatternDto] })
  patterns!: StatsPatternDto[];
}
