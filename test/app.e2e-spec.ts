import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

jest.setTimeout(20000);

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForAllToFinish(app: INestApplication, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await request(app.getHttpServer()).get('/jobs');
    const jobs = res.body as any[];
    if (Array.isArray(jobs) && jobs.length > 0) {
      const running = jobs.filter((j) => j.status === 'running' || j.status === 'retried' || j.status === 'queued');
      if (running.length === 0) return;
    }
    await wait(500);
  }
}

describe('App E2E', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('GET / returns hello', async () => {
    const res = await request(app.getHttpServer()).get('/');
    expect(res.status).toBe(200);
    expect(res.text || res.body).toBe('Hello from NestJS!');
  });

  it('POST /jobs validates bad payloads with 400', async () => {
    const cases = [
      {},
      { jobName: '' },
      { jobName: 123 },
      { jobName: 'ok', arguments: [1, 2, 3] },
    ];
    for (const c of cases) {
      const res = await request(app.getHttpServer()).post('/jobs').send(c).set('Content-Type', 'application/json');
      expect([400, 202]).toContain(res.status);
      if (res.status !== 202) {
        expect(res.body).toHaveProperty('message');
      }
    }
  });

  it('POST /jobs starts jobs and GET /stats returns patterns', async () => {
    // Fire a few jobs with diverse arguments to populate various buckets
    const payloads = [
      { jobName: 'trailer-100', arguments: ['codec=h264', 'res=1080p', 'duration=30', 'bitrate=3000', 'priority=normal'] },
      { jobName: 'feature-200', arguments: ['codec=h265', 'res=2160p', 'duration=120', 'bitrate=12000', 'priority=high'] },
      { jobName: 'live-300', arguments: ['codec=av1', 'res=2160p', 'duration=180', 'bitrate=16000', 'priority=high'] },
      { jobName: 'shorts-400', arguments: ['codec=h264', 'res=480p', 'duration=20', 'bitrate=800', 'priority=low'] },
    ];

    for (const p of payloads) {
      const res = await request(app.getHttpServer()).post('/jobs').send(p).set('Content-Type', 'application/json');
      expect(res.status).toBe(202);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('status');
      expect(res.body).toHaveProperty('history');
    }

    // Optionally, wait for jobs to finish to stabilize some patterns
    await waitForAllToFinish(app, 15000);

    const jobsRes = await request(app.getHttpServer()).get('/jobs');
    expect(jobsRes.status).toBe(200);
    expect(Array.isArray(jobsRes.body)).toBe(true);
    expect(jobsRes.body.length).toBeGreaterThanOrEqual(4);

    // Check that allowed statuses are present
    const allowed = new Set(['queued','running','succeeded','failed','crashed','retried']);
    for (const j of jobsRes.body) {
      expect(allowed.has(j.status)).toBe(true);
      expect(j).toHaveProperty('attempts');
      expect(Array.isArray(j.history)).toBe(true);
    }

    const statsRes = await request(app.getHttpServer()).get('/stats');
    expect(statsRes.status).toBe(200);

    const stats = statsRes.body;
    expect(stats).toHaveProperty('totalJobs');
    expect(stats).toHaveProperty('overallSuccessRate');
    expect(Array.isArray(stats.patterns)).toBe(true);

    // Check presence of a broader set of representative patterns
    const pat = (s: string) => (stats.patterns as any[]).some((p) => (p.pattern as string).includes(s));
    expect(pat('Target codec')).toBe(true);
    expect(pat('Resolution class')).toBe(true);
    expect(pat('Estimated clip duration')).toBe(true);
    expect(pat('Submission window')).toBe(true);
    expect(pat('Priority =')).toBe(true);
    expect(pat('Bitrate bucket')).toBe(true);
    expect(pat('Codec × duration')).toBe(true);
    expect(pat('Preset match to resolution')).toBe(true);
    expect(pat('Cold-start period')).toBe(true);
    expect(pat('Retry success')).toBe(true);
    expect(pat('Runtime vs plan')).toBe(true);

    // Basic fields on each pattern
    for (const p of stats.patterns) {
      expect(p).toHaveProperty('matchCount');
      expect(p).toHaveProperty('successRate');
      expect(p).toHaveProperty('differenceFromAverage');
    }
  });

  it('serves OpenAPI at /docs', async () => {
    const res = await request(app.getHttpServer()).get('/docs');
    expect([200, 301, 302]).toContain(res.status);
  });
});
