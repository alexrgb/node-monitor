export type JobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'crashed'
  | 'retried';

export interface JobAttempt {
  attempt: number;
  pid?: number;
  startedAt: number; // epoch ms
  finishedAt?: number; // epoch ms
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
}

export interface JobRecord {
  id: string;
  jobName: string;
  arguments: string[];
  status: JobStatus;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  lastExitCode?: number | null;
  history: JobAttempt[];
}

export interface JobSnapshot extends JobRecord {}
