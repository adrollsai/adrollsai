/**
 * Utility for enforcing strict calling window constraints.
 * Standard Business Calling Window: 09:00 AM - 07:00 PM (09:00 - 19:00) in India Standard Time (IST / Asia/Kolkata).
 * Under NO circumstances should automated or outbound calls be made outside this window unless explicitly authorized.
 */

export interface CallingSlotResult {
    isWithinWindow: boolean
    scheduledTime: Date
    currentHourIST?: number
    currentMinuteIST?: number
}

/**
 * The hours a tenant is allowed to be dialled, in 24-hour local time.
 *
 * Defaults to 09:00–19:00, which is what this module has always enforced. It is a parameter now
 * because a flat 7 PM cut-off is wrong for some businesses — a coaching institute taking evening
 * enquiries wants 09:00–20:00 — and hardcoding it meant the only way to extend one account's day
 * was to extend everybody's, or to pass `allowAfterHours` and remove the guard entirely.
 */
export interface CallingWindow {
    startHour?: number
    endHour?: number
}

const DEFAULT_START_HOUR = 9
const DEFAULT_END_HOUR = 19

function normaliseWindow(window: CallingWindow = {}): { startHour: number; endHour: number } {
    const start = Number(window.startHour)
    const end = Number(window.endHour)
    const startHour = Number.isFinite(start) && start >= 0 && start <= 23 ? Math.floor(start) : DEFAULT_START_HOUR
    const endHour = Number.isFinite(end) && end >= 1 && end <= 24 ? Math.floor(end) : DEFAULT_END_HOUR
    // A window that does not contain any hours is a bug at the call site, not an instruction to
    // stop dialling forever, so fall back rather than blocking every call.
    return endHour > startHour ? { startHour, endHour } : { startHour: DEFAULT_START_HOUR, endHour: DEFAULT_END_HOUR }
}

/**
 * Checks whether a given Date is within the allowed calling window (default: 9:00 AM to 7:00 PM IST).
 * If outside the window, returns the next valid opening slot.
 */
export function computeValidCallingSlot(
    targetDate: Date = new Date(),
    timeZone: string = 'Asia/Kolkata',
    allowAfterHours: boolean = false,
    window: CallingWindow = {}
): CallingSlotResult {
    if (allowAfterHours) {
        return { isWithinWindow: true, scheduledTime: targetDate }
    }

    const { startHour, endHour } = normaliseWindow(window)

    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        hour: 'numeric',
        minute: 'numeric'
    })
    const formattedStr = formatter.format(targetDate)
    const [hStr, mStr] = formattedStr.split(':')
    const hourVal = parseInt(hStr, 10)
    const minuteVal = parseInt(mStr, 10)

    const timeInMinutes = hourVal * 60 + minuteVal
    const startMinutes = startHour * 60
    const endMinutes = endHour * 60

    const isWithinWindow = timeInMinutes >= startMinutes && timeInMinutes < endMinutes
    if (isWithinWindow) {
        return {
            isWithinWindow: true,
            scheduledTime: targetDate,
            currentHourIST: hourVal,
            currentMinuteIST: minuteVal
        }
    }

    // Outside the window -> schedule for the next opening slot
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric'
    }).formatToParts(targetDate)
    const partMap = Object.fromEntries(parts.map(p => [p.type, p.value]))

    const year = parseInt(partMap.year, 10)
    const month = parseInt(partMap.month, 10) - 1
    const day = parseInt(partMap.day, 10)
    const hour = parseInt(partMap.hour, 10)

    let targetDay = day
    if (hour >= endHour) {
        // After the window closes -> tomorrow's opening time
        targetDay += 1
    }
    // Before the window opens -> today's opening time

    const localUtcTs = Date.UTC(year, month, targetDay, startHour, 0, 0, 0)
    const getOffset = (tz: string, d: Date) => {
        const tzStr = d.toLocaleString('en-US', { timeZone: tz })
        const locD = new Date(tzStr)
        const utcD = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }))
        return (locD.getTime() - utcD.getTime()) / 60000
    }
    const offsetMin = getOffset(timeZone, new Date(localUtcTs))
    const nextSlot = new Date(localUtcTs - offsetMin * 60000)

    return {
        isWithinWindow: false,
        scheduledTime: nextSlot,
        currentHourIST: hourVal,
        currentMinuteIST: minuteVal
    }
}

/**
 * Quick boolean check if current time is within calling hours (09:00 to 19:00 IST by default).
 */
export function isWithinCallingWindow(
    timeZone: string = 'Asia/Kolkata',
    allowAfterHours: boolean = false,
    window: CallingWindow = {}
): boolean {
    return computeValidCallingSlot(new Date(), timeZone, allowAfterHours, window).isWithinWindow
}

/** Human label for a window, e.g. "9:00 AM - 8:00 PM IST". Used in logs and the blocked-call note. */
export function describeCallingWindow(window: CallingWindow = {}): string {
    const { startHour, endHour } = normaliseWindow(window)
    const label = (h: number) => {
        const suffix = h >= 12 ? 'PM' : 'AM'
        const hour12 = h % 12 === 0 ? 12 : h % 12
        return `${hour12}:00 ${suffix}`
    }
    return `${label(startHour)} - ${label(endHour)} IST`
}

/**
 * Calculates the next automated retry slot based on an infinite decaying retry cadence.
 * Ensures the slot falls strictly between 09:00 AM and 07:00 PM IST (including weekends).
 * 
 * Cadence:
 * - Attempt 1 & 2 (Day 1): +3.5 hours from previous call (or next morning 10:30 AM if late).
 * - Attempt 3 & 4 (Day 2): Next day alternating slots (11:30 AM or 04:30 PM IST).
 * - Attempt 5 & 6 (Days 3-5): +1 to 2 days, alternating morning (11:00 AM) and afternoon (04:00 PM).
 * - Attempt 7+ (Ongoing): Spaced retry every 3 to 4 days indefinitely until conclusive!
 * 
 * Note: Saturdays and Sundays are fully active calling days within the 9:00 AM - 7:00 PM IST window.
 */
export function computeNextRetrySlot(
    attemptNumber: number = 1,
    fromDate: Date = new Date(),
    timeZone: string = 'Asia/Kolkata'
): Date {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric'
    }).formatToParts(fromDate)
    const partMap = Object.fromEntries(parts.map(p => [p.type, p.value]))

    const year = parseInt(partMap.year, 10)
    const month = parseInt(partMap.month, 10) - 1
    const day = parseInt(partMap.day, 10)
    const hour = parseInt(partMap.hour, 10)
    const minute = parseInt(partMap.minute, 10)

    const getOffset = (tz: string, d: Date) => {
        const tzStr = d.toLocaleString('en-US', { timeZone: tz })
        const locD = new Date(tzStr)
        const utcD = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }))
        return (locD.getTime() - utcD.getTime()) / 60000
    }

    const makeISTDate = (y: number, m: number, d: number, h: number, min: number = 0) => {
        const localUtc = Date.UTC(y, m, d, h, min, 0, 0)
        const offsetMin = getOffset(timeZone, new Date(localUtc))
        return new Date(localUtc - offsetMin * 60000)
    }

    let candidateDate: Date

    // Attempt 1 or 2 (Day 1): +3.5 hours (210 mins)
    if (attemptNumber <= 2) {
        const plusMinutes = 210 // 3 hours 30 mins
        const currentTotalMinutes = hour * 60 + minute
        const targetTotalMinutes = currentTotalMinutes + plusMinutes

        // If target time is between 9:00 AM and 6:30 PM (18:30) IST, schedule today!
        if (targetTotalMinutes <= 18 * 60 + 30 && targetTotalMinutes >= 9 * 60) {
            const targetH = Math.floor(targetTotalMinutes / 60)
            const targetM = targetTotalMinutes % 60
            candidateDate = makeISTDate(year, month, day, targetH, targetM)
        } else {
            // Exceeds 6:30 PM IST -> schedule tomorrow morning at 10:30 AM IST (including weekends)
            candidateDate = makeISTDate(year, month, day + 1, 10, 30)
        }
    } else if (attemptNumber <= 4) {
        // Attempt 3 or 4 (Day 2): Next day alternating slots
        const targetH = attemptNumber % 2 === 1 ? 11 : 16
        candidateDate = makeISTDate(year, month, day + 1, targetH, 30)
    } else if (attemptNumber <= 6) {
        // Attempt 5 or 6 (Days 3-5): +1 to 2 days alternating morning/afternoon
        const daysToAdd = attemptNumber === 5 ? 1 : 2
        const targetH = attemptNumber % 2 === 1 ? 11 : 16
        candidateDate = makeISTDate(year, month, day + daysToAdd, targetH, 0)
    } else {
        // Attempt 7+ (Ongoing): Persistent spaced retry every 3 to 4 days indefinitely
        const daysToAdd = 3 + (attemptNumber % 2) // 3 or 4 days
        const targetH = attemptNumber % 2 === 1 ? 11 : 16
        const targetM = attemptNumber % 2 === 1 ? 0 : 30
        candidateDate = makeISTDate(year, month, day + daysToAdd, targetH, targetM)
    }

    // Guarantee the slot strictly falls within 9:00 AM - 7:00 PM IST
    const { scheduledTime } = computeValidCallingSlot(candidateDate, timeZone)
    return scheduledTime
}
