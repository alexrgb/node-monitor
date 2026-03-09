import { JobsService } from './jobs.service';
import { CreateJobDto } from './dto/create-job.dto';

// Helper to await small delays
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('JobsService.getStats advanced patterns (unit)', () => {
  let svc: JobsService;

  beforeEach(() => {
    svc = new JobsService();
  });

  it('computes multiple correlation patterns over synthetic jobs', async () => {
    // Mock the internal private executeAttempt to avoid randomness and speed tests
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spy = jest.spyOn((svc as any).__proto__ || Object.getPrototypeOf(svc), 'executeAttempt');
    // Implementation: set job status based on name/topic for deterministic outcomes
    spy.mockImplementation(async (job: any) => {
      const start = Date.now();
      job.attempts = (job.attempts || 0) + 1;
      job.startedAt = job.startedAt ?? start;
      job.updatedAt = start;
      const shouldFailFirst = /failfirst/.test(job.jobName);
      const shouldAlwaysFail = /alwaysfail/.test(job.jobName);
      const succeed = !shouldAlwaysFail && !(shouldFailFirst && job.attempts === 1);
      job.history.push({ attempt: job.attempts, pid: 1234, startedAt: start, finishedAt: start + 50, exitCode: succeed ? 0 : 1, signal: null });
      const finishedAt = start + 50;
      job.finishedAt = finishedAt;
      job.updatedAt = finishedAt;
      if (succeed) {
        job.status = 'succeeded';
        job.lastExitCode = 0;
      } else {
        if (job.attempts < 2) {
          // simulate that runJob will call retry (we call executeAttempt again recursively here)
          job.status = 'retried';
          job.lastExitCode = 1;
          return (svc as any).executeAttempt(job, 10, 1);
        }
        job.status = 'failed';
        job.lastExitCode = 1;
      }
    });

    const make = async (dto: CreateJobDto) => svc.createJob(dto);

    // Create diverse jobs to hit many buckets
    await make({ jobName: 'trailer-001', arguments: ['codec=h264', 'res=1080p', 'duration=40', 'bitrate=3500', 'priority=normal'] });
    await make({ jobName: 'feature-uhd-failfirst', arguments: ['codec=av1', 'res=2160p', 'duration=180', 'bitrate=12000', 'priority=high'] });
    await make({ jobName: 'shorts-lowbr', arguments: ['codec=h265', 'res=720p', 'duration=20', 'bitrate=900', 'priority=low'] });
    await make({ jobName: 'live-overprov', arguments: ['codec=h264', 'res=2160p', 'duration=60', 'bitrate=20000', 'priority=high'] });
    await make({ jobName: 'feature-hd', arguments: ['codec=h265', 'res=1080p', 'duration=90', 'bitrate=3000', 'priority=normal'] });
    await make({ jobName: 'trailer-sd', arguments: ['codec=h264', 'res=480p', 'duration=25', 'bitrate=800', 'priority=normal'] });
    await make({ jobName: 'alwaysfail-misconfig', arguments: ['codec=other', 'res=weird', 'duration=150', 'bitrate=16000', 'priority=low'] });

    // allow microtasks
    await wait(5);

    const stats = svc.getStats();
    expect(stats.totalJobs).toBeGreaterThanOrEqual(7);
    expect(Array.isArray(stats.patterns)).toBe(true);

    // Expect a reasonable variety of patterns to be present
    const has = (label: string) => stats.patterns.some((p: any) => (p.pattern as string).includes(label));

    expect(has('Target codec')).toBe(true);
    expect(has('Resolution class')).toBe(true);
    expect(has('Estimated clip duration')).toBe(true);
    expect(has('Submission window')).toBe(true);
    expect(has('Priority =')).toBe(true);
    expect(has('Bitrate bucket')).toBe(true);
    expect(has('Codec × duration')).toBe(true);
    expect(has('Preset match to resolution')).toBe(true);
    expect(has('Submission window × weekend')).toBe(true);
    expect(has('Cold-start period')).toBe(true);
    expect(has('Retry success')).toBe(true);
    expect(has('failure streak')).toBe(true);
    // PID cluster may rely on history pid presence; we set pid, so should be included or empty
    // We just verify it not to throw and patterns exist
    expect(has('PID cluster')).toBe(true);
    expect(has('Runtime vs plan')).toBe(true);
    expect(has('Concurrency overlap')).toBe(true);
    expect(has('Preset completeness')).toBe(true);
    expect(has('Content type')).toBe(true);
    expect(has('Priority × submission window')).toBe(true);
    expect(has('Resolution × duration')).toBe(true);

    // Each pattern should include matchCount and successRate
    for (const p of stats.patterns) {
      expect(p).toHaveProperty('matchCount');
      expect(p).toHaveProperty('successRate');
      expect(p).toHaveProperty('differenceFromAverage');
    }
  });
});
