import { registerAs } from '@nestjs/config';

export interface AppConfig {
  port: number;
  corsOrigin?: string | boolean;
  retryEnabled: boolean;
  retryMaxAttempts: number; // total attempts including first run
  coldStartMinutes: number;
  jobMinMs: number;
  jobMaxMs: number;
  nativeSimulatorPath?: string;
}

export default registerAs<AppConfig>('app', () => {
  const num = (v: any, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const bool = (v: any, d: boolean) => {
    if (v === undefined) return d;
    const s = String(v).toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(s)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(s)) return false;
    return d;
  };

  return {
    port: num(process.env.PORT, 3000),
    corsOrigin: process.env.CORS_ORIGIN === '*' ? true : process.env.CORS_ORIGIN,
    retryEnabled: bool(process.env.RETRY_ENABLED, true),
    retryMaxAttempts: Math.max(1, num(process.env.RETRY_MAX_ATTEMPTS, 2)),
    coldStartMinutes: Math.max(0, num(process.env.COLD_START_MINUTES, 10)),
    jobMinMs: Math.max(50, num(process.env.JOB_MIN_MS, 300)),
    jobMaxMs: Math.max(200, num(process.env.JOB_MAX_MS, 8000)),
    nativeSimulatorPath: process.env.NATIVE_SIMULATOR_PATH,
  } as AppConfig;
});
