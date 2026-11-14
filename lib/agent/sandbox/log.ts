/**
 * The one logger shape the sandbox package shares.
 *
 * Same signature as `RunnerDeps['log']` in runner.ts, so an adapter's logger can
 * be handed straight to the runner and a caller can swap in a buffer for tests
 * without touching any adapter.
 */

export type AgentLogger = (event: string, data?: Record<string, unknown>) => void;

/** Default: greppable one-liners. Data is appended as JSON, never interpolated. */
export const consoleLogger: AgentLogger = (event, data) => {
  if (data === undefined) {
    console.log(`[agent-run] ${event}`);
    return;
  }
  try {
    console.log(`[agent-run] ${event} ${JSON.stringify(data)}`);
  } catch {
    console.log(`[agent-run] ${event} (unserialisable data)`);
  }
};

/** Collector for tests and for callers that persist their own event stream. */
export function bufferedLogger(): AgentLogger & { events: Array<{ event: string; data?: Record<string, unknown> }> } {
  const events: Array<{ event: string; data?: Record<string, unknown> }> = [];
  const logger = ((event, data) => {
    events.push({ event, data });
  }) as AgentLogger & { events: typeof events };
  logger.events = events;
  return logger;
}

/** Discards everything. Useful when a caller only cares about the result. */
export const silentLogger: AgentLogger = () => {};
