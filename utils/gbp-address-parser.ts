/**
 * Robust address and locality parser for Indian & International addresses.
 * Prevents unit numbers (Cabin no.2, SCO 3, Suite 400) from being misidentified as cities/localities.
 */
export function extractCityFromAddress(address: string): string {
  if (!address) return ''
  const parts = address.split(',').map(p => p.trim()).filter(Boolean)
  if (parts.length === 0) return ''

  // Unit / building identifier prefixes to exclude
  const unitRegex = /^(first|second|third|fourth|fifth|ground|top|\d+(st|nd|rd|th)?)\s+floor|^cabin\b|^sco\b|^plot\b|^suite\b|^flat\b|^shop\b|^room\b|^unit\b|^building\b|^tower\b|^block\b|^pillar\b|^near\b|^opp\b|^opposite\b|^behind\b/i
  const nonUnitParts = parts.filter(p => !unitRegex.test(p))

  // Traverse backward from country/state
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]
    if (/^(india|united states|usa|uk|canada|australia|uae|dubai)$/i.test(p)) continue
    
    // If it has state + postal code (e.g. "Punjab 140603" or "FL 33139"), the preceding token is the city!
    if (/\b\d{4,6}\b/.test(p)) {
      if (i > 0 && !unitRegex.test(parts[i - 1])) {
        const candidate = parts[i - 1].replace(/\b(distt|district|tehsil)\b/gi, '').trim()
        if (candidate.length > 2) return candidate
      }
    }
    
    // If not a unit, pure number, or complex/center/mall
    if (!unitRegex.test(p) && !/^\d+$/.test(p) && p.length > 2 && !/center|complex|plaza|mall/i.test(p)) {
      return p
    }
  }

  return nonUnitParts[0] || parts[0]
}

/**
 * Normalizes vague or generic Google categories (e.g. "Services", "Corporate Office")
 * into actionable commercial local categories.
 */
export function cleanBusinessCategory(category: string, businessName = ''): string {
  const catLower = (category || '').trim().toLowerCase()
  const nameLower = businessName.trim().toLowerCase()

  // If category is generic, infer from business name
  const isGeneric = !category || ['services', 'service', 'local business', 'establishment', 'corporate office', 'point of interest'].includes(catLower)

  if (isGeneric) {
    if (nameLower.includes('nobogent')) return 'Digital Marketing & AI Lead Generation Agency'
    if (nameLower.includes('adrolls')) return 'Performance Marketing & Advertising Agency'
    if (nameLower.includes('dent') || nameLower.includes('smile') || nameLower.includes('teeth')) return 'Dental Clinic'
    if (nameLower.includes('real') || nameLower.includes('estate') || nameLower.includes('properties')) return 'Real Estate Agency'
    if (nameLower.includes('law') || nameLower.includes('legal') || nameLower.includes('advocate')) return 'Law Firm'
    if (nameLower.includes('fit') || nameLower.includes('gym')) return 'Fitness Center & Gym'
    if (nameLower.includes('salon') || nameLower.includes('spa') || nameLower.includes('hair')) return 'Beauty Salon & Spa'
    if (nameLower.includes('tech') || nameLower.includes('soft') || nameLower.includes('cloud') || nameLower.includes('ai')) return 'Software & Technology Solutions'
    return 'B2B Business Growth & Consulting'
  }

  return category.trim()
}
