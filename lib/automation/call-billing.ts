/**
 * What one AI phone call costs, in credits.
 *
 * THE MODEL, as specified by the owner, and it reproduces all six of their worked examples exactly:
 *
 *     credits = ceil(seconds / 60) × 1   +   seconds × 0.05
 *
 * i.e. 1 credit for each minute BLOCK the call entered (charged as the block begins, which is why a
 * call that disconnects one second into a new minute still pays for that minute), plus 0.05 credits
 * for every elapsed second — telephony pro-rated per second on top of a per-minute pulse.
 *
 * It agrees with the "4 credits/min" figure the same instruction used, because 1 + (60 × 0.05) = 4.00.
 * That is also why the locked calling pot works out at exactly 500 minutes: 500 × 4 = 2,000 credits.
 *
 * ONE PLACE THE WORDS AND THE NUMBERS DISAGREED
 * The instruction said "deduct another 1 credit at every 60-second boundary (60s, 120s, 180s)", which
 * would make a 60-second call cost 5.00 and a 120-second call 9.00. Its own examples say 4.00 and
 * 8.00. The examples are self-consistent across all six data points and they are the sane reading — a
 * call that ENDS at 60s has only ever been in minute 1 — so `ceil` is what is implemented here. If the
 * boundary charge is actually wanted, this is the one function to change.
 *
 * INTEGER HUNDREDTHS, NEVER FLOATS
 * 61 seconds is 2 + 3.05 = 5.05 credits. In floating point `61 * 0.05` is 3.0500000000000003 and the
 * total drifts; in a ledger that drift accumulates into a balance nobody can reconcile. Everything
 * here is an integer number of hundredths, so the arithmetic is exact.
 */

/** Credit hundredths per second of call time. 5 hundredths = 0.05 credits. */
const HUNDREDTHS_PER_SECOND = 5;

/** Credit hundredths charged as each minute block begins. 100 hundredths = 1 credit. */
const HUNDREDTHS_PER_MINUTE_BLOCK = 100;

/** Credits locked for calling inside a 5,000-credit plan, and the minutes they buy. */
export const CALLING_POT_CREDITS = 2000;
export const CALLING_POT_MINUTES = 500;

/** A call that never connected: 0.02 credits, and it consumes no minute block. */
export const FAILED_CALL_HUNDREDTHS = 2;

/**
 * Charge for a CONNECTED call, in credit hundredths.
 *
 * `answeredSeconds` must be a real measured duration. Pass nothing for a call that never connected —
 * use `failedCallHundredths()` for those — because treating "no duration measured" as "zero seconds"
 * would bill a real conversation at the failed-call rate.
 */
export function callChargeHundredths(answeredSeconds: number): number {
  const seconds = Math.max(0, Math.floor(Number(answeredSeconds) || 0));
  if (seconds === 0) return 0;
  const blocks = Math.ceil(seconds / 60);
  return blocks * HUNDREDTHS_PER_MINUTE_BLOCK + seconds * HUNDREDTHS_PER_SECOND;
}

/** The same charge expressed in credits, for display and for `deductCredits`. */
export function callChargeCredits(answeredSeconds: number): number {
  return callChargeHundredths(answeredSeconds) / 100;
}

/** Charge for a dial that never connected (busy, no answer, rejected, failed). */
export function failedCallHundredths(): number {
  return FAILED_CALL_HUNDREDTHS;
}

/**
 * Credits a duration buys from the locked pot — used to answer "how many minutes do I have left?"
 * without re-deriving the formula somewhere else.
 */
export function minutesCoveredByCredits(credits: number): number {
  const creditHundredths = Math.floor(Math.max(0, Number(credits) || 0) * 100);
  // A full minute block is 100 + 60*5 = 400 hundredths (4.00 credits).
  return Math.floor(creditHundredths / (HUNDREDTHS_PER_MINUTE_BLOCK + 60 * HUNDREDTHS_PER_SECOND));
}
