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
 * Checks whether a given Date is within the allowed calling window (default: 9:00 AM to 7:00 PM IST).
 * If outside the window, returns the next valid 9:00 AM slot.
 */
export function computeValidCallingSlot(
    targetDate: Date = new Date(),
    timeZone: string = 'Asia/Kolkata',
    allowAfterHours: boolean = false
): CallingSlotResult {
    if (allowAfterHours) {
        return { isWithinWindow: true, scheduledTime: targetDate }
    }

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
    const startMinutes = 9 * 60     // 09:00 AM
    const endMinutes = 19 * 60      // 07:00 PM (19:00)

    const isWithinWindow = timeInMinutes >= startMinutes && timeInMinutes < endMinutes
    if (isWithinWindow) {
        return {
            isWithinWindow: true,
            scheduledTime: targetDate,
            currentHourIST: hourVal,
            currentMinuteIST: minuteVal
        }
    }

    // Outside 9 AM - 7 PM -> schedule for next valid 9:00 AM slot
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
    if (hour >= 19) {
        // After 7 PM -> schedule for tomorrow 9 AM
        targetDay += 1
    }
    // Before 9 AM -> schedule for today 9 AM

    const localUtcTs = Date.UTC(year, month, targetDay, 9, 0, 0, 0)
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
 * Quick boolean check if current time is within calling hours (09:00 to 19:00 IST)
 */
export function isWithinCallingWindow(timeZone: string = 'Asia/Kolkata', allowAfterHours: boolean = false): boolean {
    return computeValidCallingSlot(new Date(), timeZone, allowAfterHours).isWithinWindow
}
