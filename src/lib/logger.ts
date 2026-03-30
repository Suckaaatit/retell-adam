import type { StructuredLog } from '@/types';

/**
 * Structured JSON logger. All logs include timestamp, level, message, and relevant IDs.
 * NEVER logs secrets, API keys, tokens, or full request/response bodies.
 */
function emit(log: StructuredLog): void {
  const output = JSON.stringify(log);
  switch (log.level) {
    case 'error':
      console.error(output);
      break;
    case 'warn':
      console.warn(output);
      break;
    default:
      console.log(output);
  }
}

export function logInfo(message: string, context?: Partial<Omit<StructuredLog, 'level' | 'message' | 'timestamp'>>): void {
  emit({ level: 'info', message, timestamp: new Date().toISOString(), ...context });
}

export function logWarn(message: string, context?: Partial<Omit<StructuredLog, 'level' | 'message' | 'timestamp'>>): void {
  emit({ level: 'warn', message, timestamp: new Date().toISOString(), ...context });
}

export function logError(
  message: string,
  err: unknown,
  context?: Partial<Omit<StructuredLog, 'level' | 'message' | 'timestamp'>>
): void {
  const errorMessage = err instanceof Error ? err.message : String(err);
  emit({
    level: 'error',
    message,
    timestamp: new Date().toISOString(),
    error: errorMessage,
    ...context,
  });
}
