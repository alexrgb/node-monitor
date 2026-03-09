import { Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn, ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CreateJobDto } from './dto/create-job.dto';
import { JobRecord, JobSnapshot } from './job.model';
import { clampNum, deltaPctOrDash, round2, successRateOf } from './utils/stats.utils';

interface ParsedArgs {
  codec: 'h264' | 'h265' | 'av1' | 'other';
  resolution: 'sd' | 'hd' | 'uhd' | 'other';
  durationSec: number; // target simulated duration
  bitrateK: number; // optional bitrate in kbps
  priority: 'low' | 'normal' | 'high';
}

@Injectable()
export class JobsService implements OnModuleDestroy {
  private jobs = new Map<string, JobRecord>();

  // Store running child processes by job id (latest attempt)
  private children = new Map<string, ChildProcess>();

  // Service start time to analyze cold-start effects
  private readonly serviceStartMs: number = Date.now();

  constructor(@Optional() private readonly config?: ConfigService) {}

  // Cached config values
  private get coldStartMinutes(): number {
    return (this.config?.get('app.coldStartMinutes') as number) ?? 10;
  }
  private get retryEnabled(): boolean {
    return (this.config?.get('app.retryEnabled') as boolean) ?? true;
  }
  private get maxAttempts(): number {
    const v = (this.config?.get('app.retryMaxAttempts') as number) ?? 2;
    return Math.max(1, v);
  }
  private get jobMinMs(): number {
    return (this.config?.get('app.jobMinMs') as number) ?? 300;
  }
  private get jobMaxMs(): number {
    return (this.config?.get('app.jobMaxMs') as number) ?? 8000;
  }
  private get nativeOverride(): string | undefined {
    return this.config?.get('app.nativeSimulatorPath') as string | undefined;
  }

  createJob(payload: CreateJobDto): JobSnapshot {
    const id = randomUUID();
    const createdAt = Date.now();
    const args = payload.arguments ?? [];

    const record: JobRecord = {
      id,
      jobName: payload.jobName,
      arguments: args,
      status: 'queued',
      attempts: 0,
      createdAt,
      updatedAt: createdAt,
      history: [],
    };

    this.jobs.set(id, record);

    // Start asynchronously
    this.runJob(record).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Unexpected error in job runner', { id, err });
    });

    return this.snapshot(record.id)!;
  }

  getAllJobs(): JobSnapshot[] {
    return Array.from(this.jobs.values()).map((j) => ({ ...j }));
  }

  getJob(id: string): JobSnapshot | undefined {
    return this.snapshot(id);
  }

  getStats() {
    const all = Array.from(this.jobs.values());
    const totalJobs = all.length;
    const overallSuccessRate = totalJobs > 0 ? all.filter((j) => j.status === 'succeeded').length / totalJobs : 0;

    // Derive features for all jobs
    const withFeatures = all.map((j) => ({ j, f: this.extractFeatures(j) }));

    // Build patterns by delegating to specialized methods
    const patterns: any[] = [
      ...this.computeCodecPatterns(withFeatures, overallSuccessRate),
      ...this.computeResolutionPatterns(withFeatures, overallSuccessRate),
      ...this.computeDurationPatterns(withFeatures, overallSuccessRate),
      ...this.computeSubmissionWindowPatterns(all, overallSuccessRate),
      ...this.computePriorityPatterns(withFeatures, overallSuccessRate),
      ...this.computeBitratePatterns(withFeatures, overallSuccessRate),
      ...this.computeCodecDurationInteraction(withFeatures, overallSuccessRate),
      ...this.computeResolutionBitrateMismatch(withFeatures, overallSuccessRate),
      ...this.computeWeekdayWeekendPatterns(all, overallSuccessRate),
      ...this.computeColdStartPatterns(all, overallSuccessRate),
      ...this.computeRetryEffectivenessPatterns(all, overallSuccessRate),
      ...this.computeFailureStreakPatterns(withFeatures, all, overallSuccessRate),
      ...this.computePidClusteringPatterns(all, overallSuccessRate),
      ...this.computeRuntimePatterns(all, overallSuccessRate),
      ...this.computeConcurrencyPatterns(all, overallSuccessRate),
      ...this.computePresetCompletenessPatterns(all, overallSuccessRate),
      ...this.computeContentTypePatterns(all, overallSuccessRate),
      ...this.computePriorityWindowInteraction(withFeatures, overallSuccessRate),
      ...this.computeResolutionDurationInteraction(withFeatures, overallSuccessRate),
    ];

    return {
      domain: 'Video transcoding jobs aimed at improving view-start conversion rates',
      totalJobs,
      overallSuccessRate: round2(overallSuccessRate),
      patterns,
    };
  }

  private async runJob(job: JobRecord): Promise<void> {
    // Extract job features to pass to simulator
    const features = this.extractFeatures(job);

    // Calculate execution duration based on job duration
    const durationMs = Math.max(this.jobMinMs, Math.min(this.jobMaxMs, Math.round(features.durationSec * 800)));

    // Pass job to simulator with its parameters - let simulator decide success/failure
    await this.executeAttempt(job, features, durationMs);
  }

  private resolveNativeSimulatorPath(): string | undefined {
    // Explicit override via env/config
    if (this.nativeOverride) {
      if (fs.existsSync(this.nativeOverride)) return this.nativeOverride;
    }

    // Look for native/bin/simulator[.exe] relative to this file (works in src and dist)
    const rootCandidate = path.resolve(__dirname, '..', '..');
    const nativeDir = path.resolve(rootCandidate, 'native', 'bin');
    const exe = process.platform === 'win32' ? 'simulator.exe' : 'simulator';
    const full = path.join(nativeDir, exe);
    if (fs.existsSync(full)) return full;

    // Fallback: search one level up (in case of different dist layout)
    const altRoot = path.resolve(__dirname, '..', '..', '..');
    const altFull = path.join(altRoot, 'native', 'bin', exe);
    if (fs.existsSync(altFull)) return altFull;

    return undefined;
  }

  private executeAttempt(job: JobRecord, features: ParsedArgs, durationMs: number): Promise<void> {
    return new Promise((resolve) => {
      const attemptNo = job.attempts + 1;
      const startedAt = Date.now();
      job.attempts = attemptNo;
      job.status = attemptNo > 1 ? 'retried' : 'running';
      job.startedAt = job.startedAt ?? startedAt;
      job.updatedAt = startedAt;

      const nativePath = this.resolveNativeSimulatorPath();
      
      // Pass job parameters to simulator instead of pre-computed probability
      const env = {
        ...process.env,
        DURATION_MS: String(durationMs),
        CODEC: features.codec,
        RESOLUTION: features.resolution,
        DURATION_SEC: String(features.durationSec),
        BITRATE_K: String(features.bitrateK),
        PRIORITY: features.priority,
      } as NodeJS.ProcessEnv;

      let child: ChildProcess;
      if (nativePath) {
        // Spawn native simulator if available (computes success probability internally)
        child = spawn(nativePath, [], { env, stdio: 'ignore' });
      } else {
        // Fallback to Node inline script that computes probability internally
        const script = `
          const d=Number(process.env.DURATION_MS)||500;
          const codec=(process.env.CODEC||'h264').toLowerCase();
          const res=(process.env.RESOLUTION||'hd').toLowerCase();
          const dur=Number(process.env.DURATION_SEC)||45;
          const priority=(process.env.PRIORITY||'normal').toLowerCase();
          let p=0.82;
          if(codec==='av1')p-=0.18;
          else if(codec==='h265'||codec==='hevc')p-=0.08;
          if(res==='uhd'||res.includes('2160')||res.includes('4k'))p-=0.12;
          else if(res==='hd'||res.includes('1080')||res.includes('720'))p-=0.03;
          if(dur>120)p-=0.1;
          else if(dur<30)p+=0.05;
          if(priority==='high')p+=0.04;
          p=Math.max(0.05,Math.min(0.98,p));
          setTimeout(()=>{const ok=Math.random()<p;process.exit(ok?0:1);},d);
        `;
        child = spawn(process.execPath, ['-e', script], { env, stdio: 'ignore' });
      }

      this.children.set(job.id, child);

      job.history.push({ attempt: attemptNo, pid: child.pid, startedAt });

      const finalize = (code: number | null, signal: NodeJS.Signals | null) => {
        const finishedAt = Date.now();
        job.updatedAt = finishedAt;
        job.finishedAt = finishedAt;
        job.lastExitCode = code;
        const h = job.history[job.history.length - 1];
        if (h) {
          h.finishedAt = finishedAt;
          h.exitCode = code;
          h.signal = signal;
        }

        const ok = code === 0;
        if (ok) {
          job.status = 'succeeded';
          this.children.delete(job.id);
          return resolve();
        }

        // Non-zero exit or signal
        if (this.retryEnabled && attemptNo < this.maxAttempts) {
          // Schedule retry with same parameters
          this.children.delete(job.id);
          // Delay a bit before retry to simulate backoff
          setTimeout(() => {
            // Shorter retry duration to simulate partial work reuse
            const retryDuration = Math.max(200, Math.round(durationMs * 0.7));
            this.executeAttempt(job, features, retryDuration).then(resolve);
          }, 50);
        } else {
          job.status = code === null ? 'crashed' : 'failed';
          this.children.delete(job.id);
          resolve();
        }
      };

      child.on('exit', (code, signal) => finalize(code, signal));
      child.on('error', () => finalize(1, null));
    });
  }

  private extractFeatures(job: JobRecord): ParsedArgs {
    const args = job.arguments || [];

    const kv: Record<string, string> = {};
    for (const raw of args) {
      if (typeof raw !== 'string') continue;
      const a = raw as string;
      const idx = a.indexOf('=');
      if (idx > 0) {
        const k = a.slice(0, idx).trim().toLowerCase();
        const v = a.slice(idx + 1).trim();
        kv[k] = v;
      }
    }

    // codec
    const rawCodec = (kv['codec'] || '').toLowerCase();
    const codec: ParsedArgs['codec'] = rawCodec === 'h264' || rawCodec === 'h265' || rawCodec === 'av1' ? (rawCodec as any) : (rawCodec ? 'other' : 'h264');

    // resolution
    const rawRes = (kv['res'] || kv['resolution'] || '').toLowerCase();
    let resolution: ParsedArgs['resolution'] = 'hd';
    if (rawRes.includes('2160') || rawRes.includes('uhd') || rawRes.includes('4k')) resolution = 'uhd';
    else if (rawRes.includes('1080') || rawRes.includes('720') || rawRes.includes('hd')) resolution = 'hd';
    else if (rawRes.includes('480') || rawRes.includes('sd') || rawRes.includes('360')) resolution = 'sd';
    else if (rawRes) resolution = 'other';

    // duration
    const durationSec = clampNum(parseFloat(kv['duration'] || kv['durationSec'] || kv['dur']), 5, 300) ?? 45;

    // bitrate
    const bitrateK = clampNum(parseInt(kv['bitratek'] || kv['bitrate'] || kv['br'], 10), 200, 20000) ?? 2500;

    // priority
    const rawPr = (kv['priority'] || '').toLowerCase();
    const priority: ParsedArgs['priority'] = rawPr === 'high' || rawPr === 'low' ? (rawPr as any) : 'normal';

    return { codec, resolution, durationSec, bitrateK: bitrateK, priority };
  }

  onModuleDestroy() {
    // Attempt to kill running children
    for (const [, child] of this.children) {
      try {
        child.kill('SIGTERM');
      } catch {
        // Ignore errors when killing child processes during shutdown
      }
    }
    this.children.clear();
  }

  private snapshot(id: string): JobSnapshot | undefined {
    const j = this.jobs.get(id);
    return j ? { ...j, history: j.history.map((h) => ({ ...h })) } : undefined;
  }

  // ============================================================================
  // Pattern computation methods
  // ============================================================================

  private computeCodecPatterns(
    withFeatures: Array<{ j: JobRecord; f: ParsedArgs }>,
    overallSuccessRate: number,
  ): any[] {
    const patterns: any[] = [];
    const codecGroups: Record<string, JobRecord[]> = {};
    
    for (const { j, f } of withFeatures) {
      codecGroups[f.codec] = codecGroups[f.codec] || [];
      codecGroups[f.codec].push(j);
    }
    
    for (const [codec, list] of Object.entries(codecGroups)) {
      const sr = successRateOf(list);
      patterns.push({
        pattern: `Target codec = ${codec}`,
        matchCount: list.length,
        successRate: round2(sr),
        differenceFromAverage: deltaPctOrDash(list.length, sr, overallSuccessRate),
        insight:
          codec === 'av1'
            ? 'AV1 targets show lower reliability due to higher encoding complexity in our current pipeline.'
            : codec === 'h265'
            ? 'H.265 has slightly reduced success vs H.264; consider more encoder nodes with HEVC support.'
            : codec === 'h264'
            ? 'H.264 remains the most stable path; best for time-sensitive transcodes.'
            : 'Non-standard codec choices increase risk due to less-tested paths.',
      });
    }
    
    return patterns;
  }

  private computeResolutionPatterns(
    withFeatures: Array<{ j: JobRecord; f: ParsedArgs }>,
    overallSuccessRate: number,
  ): any[] {
    const patterns: any[] = [];
    const resGroups: Record<string, JobRecord[]> = {};
    
    for (const { j, f } of withFeatures) {
      resGroups[f.resolution] = resGroups[f.resolution] || [];
      resGroups[f.resolution].push(j);
    }
    
    for (const [res, list] of Object.entries(resGroups)) {
      const sr = successRateOf(list);
      patterns.push({
        pattern: `Resolution class = ${res}`,
        matchCount: list.length,
        successRate: round2(sr),
        differenceFromAverage: deltaPctOrDash(list.length, sr, overallSuccessRate),
        insight:
          res === 'uhd'
            ? 'UHD jobs fail more often; split into tiles or allocate GPU-backed workers to improve conversion.'
            : res === 'hd'
            ? 'HD jobs are a good balance of quality and reliability.'
            : res === 'sd'
            ? 'SD jobs are the most robust; consider SD fallbacks for live events.'
            : 'Unspecified resolution increases variance; ensure presets are applied.',
      });
    }
    
    return patterns;
  }

  private computeDurationPatterns(
    withFeatures: Array<{ j: JobRecord; f: ParsedArgs }>,
    overallSuccessRate: number,
  ): any[] {
    const patterns: any[] = [];
    const durGroups: Record<string, JobRecord[]> = { short: [], medium: [], long: [] };
    
    for (const { j, f } of withFeatures) {
      const bucket = f.durationSec < 30 ? 'short' : f.durationSec <= 120 ? 'medium' : 'long';
      durGroups[bucket].push(j);
    }
    
    for (const [bucket, list] of Object.entries(durGroups)) {
      const sr = successRateOf(list);
      patterns.push({
        pattern: `Estimated clip duration = ${bucket}`,
        matchCount: list.length,
        successRate: round2(sr),
        differenceFromAverage: deltaPctOrDash(list.length, sr, overallSuccessRate),
        insight:
          bucket === 'long'
            ? 'Long clips are more error-prone; enable checkpointing or chunk processing.'
            : bucket === 'medium'
            ? 'Medium clips are stable for our current infrastructure.'
            : 'Short clips complete quickly with high success; useful for rapid iteration.',
      });
    }
    
    return patterns;
  }

  private computeSubmissionWindowPatterns(all: JobRecord[], overallSuccessRate: number): any[] {
    const patterns: any[] = [];
    const hourGroups: Record<string, JobRecord[]> = { offpeak: [], work: [], peak: [] };
    
    for (const j of all) {
      const hour = new Date(j.createdAt).getHours();
      const bucket = hour < 7 ? 'offpeak' : hour < 17 ? 'work' : 'peak';
      hourGroups[bucket].push(j);
    }
    
    for (const [bucket, list] of Object.entries(hourGroups)) {
      const sr = successRateOf(list);
      patterns.push({
        pattern: `Submission window = ${bucket}`,
        matchCount: list.length,
        successRate: round2(sr),
        differenceFromAverage: deltaPctOrDash(list.length, sr, overallSuccessRate),
        insight:
          bucket === 'peak'
            ? 'Peak hours reduce success due to resource contention; autoscale encoders to protect conversion.'
            : bucket === 'work'
            ? 'Work hours are steady; schedule bulk jobs here when possible.'
            : 'Off-peak window has highest success; great for large backfills.',
      });
    }
    
    return patterns;
  }

  private computePriorityPatterns(
    withFeatures: Array<{ j: JobRecord; f: ParsedArgs }>,
    overallSuccessRate: number,
  ): any[] {
    const patterns: any[] = [];
    const prGroups: Record<string, JobRecord[]> = { low: [], normal: [], high: [] };
    
    for (const { j, f } of withFeatures) {
      prGroups[f.priority].push(j);
    }
    
    for (const [p, list] of Object.entries(prGroups)) {
      const sr = successRateOf(list);
      patterns.push({
        pattern: `Priority = ${p}`,
        matchCount: list.length,
        successRate: round2(sr),
        differenceFromAverage: deltaPctOrDash(list.length, sr, overallSuccessRate),
        insight:
          p === 'high'
            ? 'High-priority jobs may get better routing and succeed more under contention.'
            : p === 'low'
            ? 'Low-priority jobs can be preempted; consider running off-peak.'
            : 'Normal priority is baseline for throughput vs reliability.',
      });
    }
    
    return patterns;
  }

  private computeBitratePatterns(
    withFeatures: Array<{ j: JobRecord; f: ParsedArgs }>,
    overallSuccessRate: number,
  ): any[] {
    const patterns: any[] = [];
    const brBucket = (k: number) => (k <= 1500 ? 'low' : k <= 4000 ? 'mid' : 'high');
    const brGroups: Record<string, JobRecord[]> = { low: [], mid: [], high: [] };
    
    for (const { j, f } of withFeatures) {
      brGroups[brBucket(f.bitrateK)].push(j);
    }
    
    for (const [b, list] of Object.entries(brGroups)) {
      const sr = successRateOf(list);
      patterns.push({
        pattern: `Bitrate bucket = ${b}`,
        matchCount: list.length,
        successRate: round2(sr),
        differenceFromAverage: deltaPctOrDash(list.length, sr, overallSuccessRate),
        insight:
          b === 'high'
            ? 'Very high bitrates stress encoders; expect more failures/timeouts.'
            : b === 'low'
            ? 'Low bitrates are easier to encode and usually more stable.'
            : 'Mid-range bitrates balance quality and reliability.',
      });
    }
    
    return patterns;
  }

  private computeCodecDurationInteraction(
    withFeatures: Array<{ j: JobRecord; f: ParsedArgs }>,
    overallSuccessRate: number,
  ): any[] {
    const patterns: any[] = [];
    const cdMatrix: Record<string, Record<string, JobRecord[]>> = {};
    
    for (const { j, f } of withFeatures) {
      const db = f.durationSec < 30 ? 'short' : f.durationSec <= 120 ? 'medium' : 'long';
      cdMatrix[f.codec] = cdMatrix[f.codec] || { short: [], medium: [], long: [] };
      cdMatrix[f.codec][db] = cdMatrix[f.codec][db] || [];
      cdMatrix[f.codec][db].push(j);
    }
    
    for (const [codec, byDur] of Object.entries(cdMatrix)) {
      for (const [db, list] of Object.entries(byDur)) {
        const sr = successRateOf(list);
        patterns.push({
          pattern: `Codec × duration = ${codec}/${db}`,
          matchCount: list.length,
          successRate: round2(sr),
          differenceFromAverage: deltaPctOrDash(list.length, sr, overallSuccessRate),
          insight:
            codec === 'av1' && db === 'long'
              ? 'Long AV1 encodes are fragile; consider chunking or alternative codecs.'
              : 'Combination-specific reliability profile.',
        });
      }
    }
    
    return patterns;
  }

  private computeResolutionBitrateMismatch(
    withFeatures: Array<{ j: JobRecord; f: ParsedArgs }>,
    overallSuccessRate: number,
  ): any[] {
    const patterns: any[] = [];
    
    const mismatch = (res: string, br: number): 'under' | 'right' | 'over' => {
      if (res === 'sd') return br < 1200 ? 'under' : br <= 2500 ? 'right' : 'over';
      if (res === 'hd') return br < 2500 ? 'under' : br <= 6000 ? 'right' : 'over';
      if (res === 'uhd') return br < 8000 ? 'under' : br <= 16000 ? 'right' : 'over';
      return br < 2000 ? 'under' : br <= 5000 ? 'right' : 'over';
    };
    
    const mmGroups: Record<string, JobRecord[]> = { under: [], right: [], over: [] };
    for (const { j, f } of withFeatures) {
      mmGroups[mismatch(f.resolution, f.bitrateK)].push(j);
    }
    
    for (const [cl, list] of Object.entries(mmGroups)) {
      const sr = successRateOf(list);
      patterns.push({
        pattern: `Preset match to resolution = ${cl}`,
        matchCount: list.length,
        successRate: round2(sr),
        differenceFromAverage: deltaPctOrDash(list.length, sr, overallSuccessRate),
        insight:
          cl === 'under'
            ? 'Under-provisioned presets correlate with instability and failures.'
            : cl === 'over'
            ? 'Over-provisioned presets cause memory pressure and timeouts.'
            : 'Right-sized presets yield more stable outcomes.',
      });
    }
    
    return patterns;
  }

  private computeWeekdayWeekendPatterns(all: JobRecord[], overallSuccessRate: number): any[] {
    const patterns: any[] = [];
    const wwGroups: Record<string, JobRecord[]> = {};
    
    for (const j of all) {
      const d = new Date(j.createdAt);
      const hour = d.getHours();
      const window = hour < 7 ? 'offpeak' : hour < 17 ? 'work' : 'peak';
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      const key = `${window}/${isWeekend ? 'weekend' : 'weekday'}`;
      wwGroups[key] = wwGroups[key] || [];
      wwGroups[key].push(j);
    }
    
    for (const [k, list] of Object.entries(wwGroups)) {
      const sr = successRateOf(list);
      patterns.push({
        pattern: `Submission window × weekend = ${k}`,
        matchCount: list.length,
        successRate: round2(sr),
        differenceFromAverage: deltaPctOrDash(list.length, sr, overallSuccessRate),
        insight: k.includes('weekend')
          ? 'Weekend behavior differs; consider scheduling backfills accordingly.'
          : 'Weekday traffic patterns are steadier.',
      });
    }
    
    return patterns;
  }

  private computeColdStartPatterns(all: JobRecord[], overallSuccessRate: number): any[] {
    const patterns: any[] = [];
    const coldCutoff = this.serviceStartMs + this.coldStartMinutes * 60 * 1000;
    const cold = all.filter((j) => j.createdAt <= coldCutoff);
    const warm = all.filter((j) => j.createdAt > coldCutoff);
    
    const srCold = successRateOf(cold);
    const srWarm = successRateOf(warm);
    
    patterns.push({
      pattern: 'Cold-start period (first 10m)',
      matchCount: cold.length,
      successRate: round2(srCold),
      differenceFromAverage: deltaPctOrDash(cold.length, srCold, overallSuccessRate),
      insight: 'Early submissions may suffer from JIT/warmup/cache misses.',
    });
    
    patterns.push({
      pattern: 'Warm period (after 10m)',
      matchCount: warm.length,
      successRate: round2(srWarm),
      differenceFromAverage: deltaPctOrDash(warm.length, srWarm, overallSuccessRate),
      insight: 'Warm system generally yields higher reliability.',
    });
    
    return patterns;
  }

  private computeRetryEffectivenessPatterns(all: JobRecord[], overallSuccessRate: number): any[] {
    const patterns: any[] = [];
    const retried = all.filter((j) => j.attempts > 1);
    const retriedSucceeded = retried.filter((j) => j.status === 'succeeded');
    const firstAttemptFailedThenSucceeded = retriedSucceeded.filter(
      (j) => (j.history[0]?.exitCode ?? 0) !== 0,
    );
    
    const srRetry = retried.length ? retriedSucceeded.length / retried.length : 0;
    const srFirstFix = retried.length ? firstAttemptFailedThenSucceeded.length / retried.length : 0;
    
    patterns.push({
      pattern: 'Retry success (any retried jobs)',
      matchCount: retried.length,
      successRate: round2(srRetry),
      differenceFromAverage: deltaPctOrDash(retried.length, srRetry, overallSuccessRate),
      insight: 'Single retry can recover a share of failures; tune backoff/boost policies.',
    });
    
    patterns.push({
      pattern: 'First attempt failed → success on retry',
      matchCount: retried.length,
      successRate: round2(srFirstFix),
      differenceFromAverage: deltaPctOrDash(retried.length, srFirstFix, overallSuccessRate),
      insight: 'Measures how often retry directly flips the outcome.',
    });
    
    return patterns;
  }

  private computeFailureStreakPatterns(
    withFeatures: Array<{ j: JobRecord; f: ParsedArgs }>,
    all: JobRecord[],
    overallSuccessRate: number,
  ): any[] {
    const patterns: any[] = [];
    const flaggedJobs = new Set<string>();
    
    // Build codec groups for streak analysis
    const codecGroups: Record<string, JobRecord[]> = {};
    for (const { j, f } of withFeatures) {
      codecGroups[f.codec] = codecGroups[f.codec] || [];
      codecGroups[f.codec].push(j);
    }
    
    for (const codec of Object.keys(codecGroups)) {
      const seq = withFeatures
        .filter((x) => x.f.codec === codec)
        .map((x) => x.j)
        .sort((a, b) => a.createdAt - b.createdAt);
      
      for (let i = 0; i + 4 < seq.length; i++) {
        const win = seq.slice(i, i + 5);
        const fails = win.filter((j) => j.status !== 'succeeded').length;
        if (fails >= 3) {
          win.forEach((j) => flaggedJobs.add(j.id));
        }
      }
    }
    
    const inStreak = all.filter((j) => flaggedJobs.has(j.id));
    const outStreak = all.filter((j) => !flaggedJobs.has(j.id));
    
    const srInStreak = successRateOf(inStreak);
    const srOutStreak = successRateOf(outStreak);
    
    patterns.push({
      pattern: 'Codec-specific failure streak windows',
      matchCount: inStreak.length,
      successRate: round2(srInStreak),
      differenceFromAverage: deltaPctOrDash(inStreak.length, srInStreak, overallSuccessRate),
      insight: 'Streaks hint at codec-specific outages or saturation; trigger health checks.',
    });
    
    patterns.push({
      pattern: 'Outside failure streak windows',
      matchCount: outStreak.length,
      successRate: round2(srOutStreak),
      differenceFromAverage: deltaPctOrDash(outStreak.length, srOutStreak, overallSuccessRate),
      insight: 'Baseline outside streaks.',
    });
    
    return patterns;
  }

  private computePidClusteringPatterns(all: JobRecord[], overallSuccessRate: number): any[] {
    const patterns: any[] = [];
    const pidGroups = new Map<number, JobRecord[]>();
    
    for (const j of all) {
      for (const h of j.history) {
        if (h.pid) {
          const arr = pidGroups.get(h.pid) || [];
          arr.push(j);
          pidGroups.set(h.pid, arr);
        }
      }
    }
    
    // Take top 3 PIDs by sample size
    const pidEntries = Array.from(pidGroups.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 3);
    
    for (const [pid, list] of pidEntries) {
      const sr = successRateOf(list);
      patterns.push({
        pattern: `PID cluster ${pid}`,
        matchCount: list.length,
        successRate: round2(sr),
        differenceFromAverage: deltaPctOrDash(list.length, sr, overallSuccessRate),
        insight: 'Identify processes/hosts with disproportionate failures; consider recycling.',
      });
    }
    
    return patterns;
  }

  private computeRuntimePatterns(all: JobRecord[], overallSuccessRate: number): any[] {
    const patterns: any[] = [];
    
    const runtimeClassOf = (j: JobRecord) => {
      const f = this.extractFeatures(j);
      const last = j.history[j.history.length - 1];
      if (!last || !last.finishedAt) return 'unknown';
      const runMs = last.finishedAt - last.startedAt;
      const planned = Math.max(1, f.durationSec * 1000);
      const ratio = runMs / planned;
      return ratio < 0.5 ? 'muchShorter' : ratio <= 1.5 ? 'nearPlanned' : 'muchLonger';
    };
    
    const rtGroups: Record<string, JobRecord[]> = {
      muchShorter: [],
      nearPlanned: [],
      muchLonger: [],
      unknown: [],
    };
    
    for (const j of all) {
      const cls = runtimeClassOf(j);
      rtGroups[cls].push(j);
    }
    
    for (const [cl, list] of Object.entries(rtGroups)) {
      const sr = successRateOf(list);
      patterns.push({
        pattern: `Runtime vs plan = ${cl}`,
        matchCount: list.length,
        successRate: round2(sr),
        differenceFromAverage: deltaPctOrDash(list.length, sr, overallSuccessRate),
        insight:
          cl === 'muchLonger'
            ? 'Overruns indicate throttling/timeouts; review resource fits.'
            : cl === 'muchShorter'
            ? 'Under-runs can indicate early exit/crash.'
            : 'Expected runtimes are most stable.',
      });
    }
    
    return patterns;
  }

  private computeConcurrencyPatterns(all: JobRecord[], overallSuccessRate: number): any[] {
    const patterns: any[] = [];
    
    const overlapCountAt = (t: number) => {
      let c = 0;
      for (const j of all) {
        const first = j.history[0];
        const last = j.history[j.history.length - 1];
        if (first && first.startedAt && last && last.finishedAt) {
          if (first.startedAt <= t && last.finishedAt >= t) c++;
        }
      }
      return c;
    };
    
    const ocBucket = (n: number) => (n <= 2 ? 'low' : n <= 6 ? 'medium' : 'high');
    const ocGroups: Record<string, JobRecord[]> = { low: [], medium: [], high: [] };
    
    for (const j of all) {
      const c = overlapCountAt(j.createdAt);
      ocGroups[ocBucket(c)].push(j);
    }
    
    for (const [k, list] of Object.entries(ocGroups)) {
      const sr = successRateOf(list);
      patterns.push({
        pattern: `Concurrency overlap = ${k}`,
        matchCount: list.length,
        successRate: round2(sr),
        differenceFromAverage: deltaPctOrDash(list.length, sr, overallSuccessRate),
        insight:
          k === 'high'
            ? 'High overlap correlates with contention; consider admission control.'
            : 'Lower overlap correlates with higher stability.',
      });
    }
    
    return patterns;
  }

  private computePresetCompletenessPatterns(all: JobRecord[], overallSuccessRate: number): any[] {
    const patterns: any[] = [];
    
    const completeness = (j: JobRecord) => {
      const kv: Record<string, string> = {};
      for (const a of j.arguments || []) {
        const i = a.indexOf('=');
        if (i > 0) kv[a.slice(0, i).toLowerCase()] = a.slice(i + 1);
      }
      const required = new Set<string>(['codec', 'res', 'duration', 'bitrate', 'priority']);
      let have = 0;
      for (const r of required) {
        if (kv[r] || kv[r + 'sec'] || kv['br']) have++;
      }
      return have >= 5 ? 'complete' : have >= 3 ? 'partial' : 'minimal';
    };
    
    const pcGroups: Record<string, JobRecord[]> = { complete: [], partial: [], minimal: [] };
    for (const j of all) {
      pcGroups[completeness(j)].push(j);
    }
    
    for (const [k, list] of Object.entries(pcGroups)) {
      const sr = successRateOf(list);
      patterns.push({
        pattern: `Preset completeness = ${k}`,
        matchCount: list.length,
        successRate: round2(sr),
        differenceFromAverage: deltaPctOrDash(list.length, sr, overallSuccessRate),
        insight:
          k === 'complete'
            ? 'Complete presets correlate with higher reliability.'
            : k === 'minimal'
            ? 'Minimal presets correlate with misconfigurations and failures.'
            : 'Partially specified presets show mixed reliability.',
      });
    }
    
    return patterns;
  }

  private computeContentTypePatterns(all: JobRecord[], overallSuccessRate: number): any[] {
    const patterns: any[] = [];
    
    const ctOf = (name: string) => {
      const n = (name || '').toLowerCase();
      if (n.startsWith('trailer-')) return 'trailer';
      if (n.startsWith('feature-')) return 'feature';
      if (n.startsWith('shorts-')) return 'shorts';
      if (n.startsWith('live-')) return 'live';
      return 'other';
    };
    
    const ctGroups: Record<string, JobRecord[]> = {};
    for (const j of all) {
      const ct = ctOf(j.jobName);
      ctGroups[ct] = ctGroups[ct] || [];
      ctGroups[ct].push(j);
    }
    
    for (const [ct, list] of Object.entries(ctGroups)) {
      const sr = successRateOf(list);
      patterns.push({
        pattern: `Content type = ${ct}`,
        matchCount: list.length,
        successRate: round2(sr),
        differenceFromAverage: deltaPctOrDash(list.length, sr, overallSuccessRate),
        insight:
          ct === 'live'
            ? 'Live content is fragile; allocate reserved capacity and SD fallbacks.'
            : 'Different content types have distinct reliability profiles.',
      });
    }
    
    return patterns;
  }

  private computePriorityWindowInteraction(
    withFeatures: Array<{ j: JobRecord; f: ParsedArgs }>,
    overallSuccessRate: number,
  ): any[] {
    const patterns: any[] = [];
    const pwGroups: Record<string, JobRecord[]> = {};
    
    for (const { j, f } of withFeatures) {
      const hour = new Date(j.createdAt).getHours();
      const win = hour < 7 ? 'offpeak' : hour < 17 ? 'work' : 'peak';
      const key = `${f.priority}/${win}`;
      pwGroups[key] = pwGroups[key] || [];
      pwGroups[key].push(j);
    }
    
    for (const [k, list] of Object.entries(pwGroups)) {
      const sr = successRateOf(list);
      patterns.push({
        pattern: `Priority × submission window = ${k}`,
        matchCount: list.length,
        successRate: round2(sr),
        differenceFromAverage: deltaPctOrDash(list.length, sr, overallSuccessRate),
        insight: 'Cross-effect of SLA with contention window.',
      });
    }
    
    return patterns;
  }

  private computeResolutionDurationInteraction(
    withFeatures: Array<{ j: JobRecord; f: ParsedArgs }>,
    overallSuccessRate: number,
  ): any[] {
    const patterns: any[] = [];
    const rdGroups: Record<string, JobRecord[]> = {};
    
    for (const { j, f } of withFeatures) {
      const db = f.durationSec < 30 ? 'short' : f.durationSec <= 120 ? 'medium' : 'long';
      const key = `${f.resolution}/${db}`;
      rdGroups[key] = rdGroups[key] || [];
      rdGroups[key].push(j);
    }
    
    for (const [k, list] of Object.entries(rdGroups)) {
      const sr = successRateOf(list);
      patterns.push({
        pattern: `Resolution × duration = ${k}`,
        matchCount: list.length,
        successRate: round2(sr),
        differenceFromAverage: deltaPctOrDash(list.length, sr, overallSuccessRate),
        insight:
          k.startsWith('uhd/') && k.endsWith('/long')
            ? 'UHD-long jobs are risky; prefer chunking/GPU.'
            : 'Combination-specific reliability.',
      });
    }
    
    return patterns;
  }
}
