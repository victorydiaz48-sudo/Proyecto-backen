/**
 * Minimal structured JSON logger (one JSON object per line on stdout).
 * Hosting dashboards (Railway/Render) index these lines, so every job event
 * is searchable by `event` and `jobId`.
 */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Canonical per-job lifecycle events. Later phases add the remaining ones. */
export const LogEvent = {
  JOB_STARTED: 'JOB_STARTED',
  IMAGE_RECEIVED: 'IMAGE_RECEIVED',
  IMAGE_ANALYZED: 'IMAGE_ANALYZED',
  COPY_GENERATED: 'COPY_GENERATED',
  IMAGE_GENERATED: 'IMAGE_GENERATED',
  VIDEO_STARTED: 'VIDEO_STARTED',
  VIDEO_COMPLETED: 'VIDEO_COMPLETED',
  QA_STARTED: 'QA_STARTED',
  QA_FAILED: 'QA_FAILED',
  JOB_RETRYING: 'JOB_RETRYING',
  JOB_COMPLETED: 'JOB_COMPLETED',
  JOB_FAILED: 'JOB_FAILED',
} as const;
export type LogEvent = (typeof LogEvent)[keyof typeof LogEvent];

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

export type LogSink = (line: string) => void;

function serializeError(err: unknown): unknown {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown; error?: unknown }).cause ?? (err as { error?: unknown }).error;
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      ...(cause instanceof Error ? { cause: { name: cause.name, message: cause.message } } : {}),
    };
  }
  return err;
}

/** Replace every occurrence of the given secrets (e.g. a bot token inside a URL). */
export function redactSecrets(text: string, secrets: readonly (string | undefined)[]): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 8) out = out.split(s).join('[REDACTED]');
  return out;
}

export function createLogger(
  opts: { level?: LogLevel; bindings?: LogFields; sink?: LogSink; redact?: readonly (string | undefined)[] } = {},
): Logger {
  const minIdx = LOG_LEVELS.indexOf(opts.level ?? 'info');
  const bindings = opts.bindings ?? {};
  const baseSink: LogSink = opts.sink ?? ((line) => process.stdout.write(line + '\n'));
  const secrets = opts.redact ?? [];
  const sink: LogSink = secrets.length ? (line) => baseSink(redactSecrets(line, secrets)) : baseSink;

  const write = (level: LogLevel, msg: string, fields?: LogFields) => {
    if (LOG_LEVELS.indexOf(level) < minIdx) return;
    const entry: LogFields = { level, time: new Date().toISOString(), msg, ...bindings };
    for (const [k, v] of Object.entries(fields ?? {})) {
      entry[k] = k === 'err' ? serializeError(v) : v;
    }
    sink(JSON.stringify(entry));
  };

  return {
    debug: (m, f) => write('debug', m, f),
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
    child: (b) => createLogger({ level: opts.level, bindings: { ...bindings, ...b }, sink }),
  };
}

export const silentLogger: Logger = createLogger({ sink: () => {} });
