/**
 * Utility functions for statistics computation
 */

import { JobRecord } from '../job.model';

/**
 * Clamps a numeric value between min and max bounds
 */
export function clampNum(v: any, min: number, max: number): number | undefined {
  const n = typeof v === 'number' && !Number.isNaN(v) ? v : parseFloat(v);
  if (Number.isFinite(n)) return Math.max(min, Math.min(max, n));
  return undefined;
}

/**
 * Computes the percentage difference from a base value, formatted as +/-XX%
 */
export function deltaPct(v: number, base: number): string {
  const d = v - base;
  const pct = Math.round(Math.abs(d) * 100);
  const sign = d >= 0 ? '+' : '-';
  return `${sign}${pct}%`;
}

/**
 * Computes the percentage difference when matchCount > 0, otherwise returns '-'
 */
export function deltaPctOrDash(matchCount: number, successRate: number, overallSuccessRate: number): string {
  if (matchCount === 0) return '-';
  return deltaPct(successRate, overallSuccessRate);
}

/**
 * Rounds a number to 2 decimal places
 */
export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Computes the success rate for a list of job records
 */
export function successRateOf(list: JobRecord[]): number {
  if (list.length === 0) return 0;
  const succeeded = list.filter((x) => x.status === 'succeeded').length;
  return succeeded / list.length;
}

/**
 * Groups an array by a key function
 */
export function groupBy<T, K extends string | number>(
  items: T[],
  keyFn: (item: T) => K,
): Record<K, T[]> {
  const groups = {} as Record<K, T[]>;
  for (const item of items) {
    const key = keyFn(item);
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  return groups;
}
