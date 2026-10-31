/**
 * Comprehensive Festival Calendar & Engine for Nobogent Creative Automation.
 * Maps festivals by country with exact dates and festive prompt visual guidelines.
 */

export interface FestivalInfo {
  id: string;
  name: string;
  country: string; // ISO code e.g. "IN", "US", "AE", "GB", "CA", "GLOBAL"
  month: number;   // 1 - 12
  day: number;     // 1 - 31
  greeting: string;
  visualTheme: string;
  headlineTemplate: string;
  hashtags: string[];
}

// 2026 Festival Calendar Dates (Accurately mapped for current active year)
export const FESTIVALS_2026: FestivalInfo[] = [
  // --- INDIA (IN) ---
  {
    id: 'in-makar-sankranti',
    name: 'Makar Sankranti & Pongal',
    country: 'IN',
    month: 1,
    day: 14,
    greeting: 'Wishing you a joyful and prosperous Makar Sankranti and Pongal!',
    visualTheme: 'Vibrant kites in a bright golden sky, traditional earthen pots overflowing with sweet rice, sugarcane, festive marigold decorations, warm sunbeams.',
    headlineTemplate: 'May this festive season bring high aspirations and boundless success!',
    hashtags: ['#HappyMakarSankranti', '#Pongal', '#FestiveWishes']
  },
  {
    id: 'in-republic-day',
    name: 'Republic Day',
    country: 'IN',
    month: 1,
    day: 26,
    greeting: 'Happy 77th Republic Day to all citizens! Celebrating pride, sovereignty, and progress.',
    visualTheme: 'Majestic Indian tricolor silk flag gracefully flowing, Ashoka Chakra emblem in regal metallic gold, sleek architectural pride, warm atmospheric dusk.',
    headlineTemplate: 'Proudly building the future of modern India.',
    hashtags: ['#RepublicDay', '#VandeMataram', '#PrideOfIndia']
  },
  {
    id: 'in-maha-shivratri',
    name: 'Maha Shivratri',
    country: 'IN',
    month: 2,
    day: 15,
    greeting: 'Har Har Mahadev! Wishing you peace, divine grace, and spiritual elevation on Maha Shivratri.',
    visualTheme: 'Mystical trishul and damru with divine golden aura, sacred bilva leaves, serene Himalayan mountains with ethereal mist, soft sacred candlelight glow.',
    headlineTemplate: 'May divine strength and wisdom guide your journey.',
    hashtags: ['#MahaShivratri', '#HarHarMahadev', '#DivineBlessings']
  },
  {
    id: 'in-holi',
    name: 'Holi (Festival of Colors)',
    country: 'IN',
    month: 3,
    day: 4,
    greeting: 'Wishing you and your family a vibrant, colorful, and joyous Holi!',
    visualTheme: 'Explosion of vibrant organic gulal powders (magenta, golden yellow, turquoise, royal indigo) frozen in mid-air, joyful elegant atmosphere, premium festive design layout.',
    headlineTemplate: 'Adding vibrant colors of success, warmth, and prosperity to your life!',
    hashtags: ['#HappyHoli', '#FestivalOfColors', '#HoliCelebrations']
  },
  {
    id: 'in-eid-ul-fitr',
    name: 'Eid-ul-Fitr',
    country: 'IN',
    month: 3,
    day: 20,
    greeting: 'Eid Mubarak! May divine peace, joy, and prosperity bless your home and business.',
    visualTheme: 'Radiant golden crescent moon with delicate star, ornate Arabian archways and lanterns (fanous), warm candlelit glow, pristine luxury setting with white and gold accents.',
    headlineTemplate: 'Wishing you and your loved ones a blessed, peaceful, and joyous Eid!',
    hashtags: ['#EidMubarak', '#HappyEid', '#PeaceAndProsperity']
  },
  {
    id: 'in-baisakhi',
    name: 'Baisakhi',
    country: 'IN',
    month: 4,
    day: 13,
    greeting: 'Happy Baisakhi! May this harvest season bring abundant joy, wealth, and new beginnings.',
    visualTheme: 'Golden ripe wheat fields swaying under warm sunshine, festive dhol drum with colorful tassels, rich Punjabi cultural warmth, premium celebratory mood.',
    headlineTemplate: 'Celebrating the harvest of hard work, growth, and fruitful endeavors.',
    hashtags: ['#HappyBaisakhi', '#HarvestSeason', '#FestiveJoy']
  },
  {
    id: 'in-eid-ul-adha',
    name: 'Eid-ul-Adha (Bakrid)',
    country: 'IN',
    month: 5,
    day: 27,
    greeting: 'Eid-ul-Adha Mubarak! Celebrating devotion, sacrifice, and community togetherness.',
    visualTheme: 'Islamic geometry with glowing gold lanterns, crescent moon under starlit midnight sky, sophisticated elegant typography, opulent celebratory warmth.',
    headlineTemplate: 'May your days be blessed with peace, harmony, and gratitude.',
    hashtags: ['#EidAlAdha', '#EidMubarak', '#Blessings']
  },
  {
    id: 'in-independence-day',
    name: 'Independence Day',
    country: 'IN',
    month: 8,
    day: 15,
    greeting: 'Happy 80th Independence Day! Saluting the spirit of freedom and visionary leadership.',
    visualTheme: 'Indian tricolor flowing across a dramatic sunrise sky, elegant saffron, white, and emerald green gradient waves, sleek modern architecture in background.',
    headlineTemplate: 'Celebrating independence, innovation, and national progress.',
    hashtags: ['#IndependenceDay', '#IndiaAt80', '#JaiHind']
  },
  {
    id: 'in-raksha-bandhan',
    name: 'Raksha Bandhan',
    country: 'IN',
    month: 8,
    day: 28,
    greeting: 'Happy Raksha Bandhan! Celebrating the unbreakable bond of love, care, and protection.',
    visualTheme: 'Intricate golden and silk thread Rakhi resting on a decorative thali with sweets and flowers, soft bokeh lighting, warm emotional festive elegance.',
    headlineTemplate: 'Cherishing bonds that protect, inspire, and endure.',
    hashtags: ['#RakshaBandhan', '#HappyRakhi', '#FamilyBonds']
  },
  {
    id: 'in-ganesh-chaturthi',
    name: 'Ganesh Chaturthi',
    country: 'IN',
    month: 9,
    day: 15,
    greeting: 'Ganpati Bappa Morya! May Lord Ganesha remove all obstacles and bless you with prosperity.',
    visualTheme: 'Majestic golden Lord Ganesha idol silhouette with glowing aura, traditional marigold garlands, modak offerings, lit brass oil lamps (samai), grand festive setting.',
    headlineTemplate: 'Welcoming wisdom, auspicious beginnings, and immense success.',
    hashtags: ['#GaneshChaturthi', '#GanpatiBappaMorya', '#AuspiciousBeginnings']
  },
  {
    id: 'in-navratri',
    name: 'Navratri & Durga Puja',
    country: 'IN',
    month: 10,
    day: 11,
    greeting: 'Shubh Navratri! May Goddess Durga empower you with strength, grace, and abundance.',
    visualTheme: 'Divine Goddess Durga golden trident (Trishul) with lotus and sacred fire, glowing festive earthen lamps, colorful dandiya sticks in background, rich royal crimson and gold.',
    headlineTemplate: 'Celebrating divine power, triumphs of virtue, and festive devotion.',
    hashtags: ['#HappyNavratri', '#DurgaPuja', '#DivineEnergy']
  },
  {
    id: 'in-dussehra',
    name: 'Dussehra / Vijayadashami',
    country: 'IN',
    month: 10,
    day: 20,
    greeting: 'Happy Dussehra! Celebrating the eternal victory of light over darkness and good over evil.',
    visualTheme: 'Golden bow and arrow with radiant flaming light beam, majestic victory celebration, auspicious apta leaves with gold coins, uplifting heroic ambiance.',
    headlineTemplate: 'Conquering challenges and celebrating triumphant breakthroughs.',
    hashtags: ['#HappyDussehra', '#Vijayadashami', '#VictoryOfGood']
  },
  {
    id: 'in-diwali',
    name: 'Diwali (Deepavali)',
    country: 'IN',
    month: 11,
    day: 8,
    greeting: 'Wishing you and your family a luminous, joyous, and prosperous Diwali!',
    visualTheme: 'Breathtaking array of glowing clay diyas with warm amber flames, intricate rangoli illuminated by fairy lights, soft golden sparkles in night sky, opulent luxury aesthetic.',
    headlineTemplate: 'May the festival of lights illuminate your path to prosperity, wealth, and grandeur.',
    hashtags: ['#HappyDiwali', '#Deepavali', '#FestivalOfLights', '#Prosperity']
  },
  {
    id: 'in-guru-nanak-jayanti',
    name: 'Guru Nanak Jayanti (Gurpurab)',
    country: 'IN',
    month: 11,
    day: 24,
    greeting: 'Happy Gurpurab! May the divine teachings of Guru Nanak Dev Ji inspire peace and universal love.',
    visualTheme: 'Golden Temple (Harmandir Sahib) illuminated against a tranquil night water reflection, glowing golden Ik Onkar emblem, sacred candles, spiritual serene atmosphere.',
    headlineTemplate: 'Guided by compassion, equality, and selfless service.',
    hashtags: ['#Gurpurab', '#GuruNanakJayanti', '#SpiritualPeace']
  },

  // --- UNITED STATES (US) ---
  {
    id: 'us-new-year',
    name: "New Year's Day",
    country: 'US',
    month: 1,
    day: 1,
    greeting: 'Happy New Year! Wishing you a brilliant and prosperous year ahead.',
    visualTheme: 'Elegant champagne flutes with golden bubbles, glittering confetti, modern city skyline at midnight, luxury dark and gold aesthetic.',
    headlineTemplate: 'Step into a new year of visionary milestones and endless opportunities.',
    hashtags: ['#HappyNewYear', '#NewBeginnings', '#Success2026']
  },
  {
    id: 'us-valentines',
    name: "Valentine's Day",
    country: 'US',
    month: 2,
    day: 14,
    greeting: "Happy Valentine's Day! Celebrating love, appreciation, and meaningful relationships.",
    visualTheme: 'Subtle luxury red velvet accents, modern minimalist heart sculptures, soft candlelit ambiance, sophisticated romantic styling.',
    headlineTemplate: 'Created with passion, delivered with love.',
    hashtags: ['#ValentinesDay', '#CelebrateLove', '#Appreciation']
  },
  {
    id: 'us-independence-day',
    name: '4th of July (Independence Day)',
    country: 'US',
    month: 7,
    day: 4,
    greeting: 'Happy 4th of July! Celebrating American freedom, courage, and ingenuity.',
    visualTheme: 'Spectacular fireworks exploding over an iconic city skyline, subtle patriotic red, white, and navy accents, warm summer evening lighting.',
    headlineTemplate: 'Celebrating freedom, community, and the American dream.',
    hashtags: ['#4thOfJuly', '#IndependenceDay', '#USA']
  },
  {
    id: 'us-halloween',
    name: 'Halloween',
    country: 'US',
    month: 10,
    day: 31,
    greeting: 'Happy Halloween! Wishing you a spooktacular day filled with sweet treats and fun.',
    visualTheme: 'Artfully carved glowing jack-o-lanterns with warm amber light, elegant autumn leaves, moody atmospheric twilight with modern luxury flair.',
    headlineTemplate: 'No tricks, just extraordinary value and delightful results.',
    hashtags: ['#HappyHalloween', '#TrickOrTreat', '#AutumnVibes']
  },
  {
    id: 'us-thanksgiving',
    name: 'Thanksgiving',
    country: 'US',
    month: 11,
    day: 26,
    greeting: 'Happy Thanksgiving! We are grateful for our wonderful partners and clients.',
    visualTheme: 'Warm autumnal dining table with heirloom pumpkins, golden oak leaves, warm candle glow, rustic luxury harvest celebration.',
    headlineTemplate: 'Giving thanks for our community, shared achievements, and trusted partnerships.',
    hashtags: ['#HappyThanksgiving', '#Gratitude', '#Blessed']
  },
  {
    id: 'us-christmas',
    name: 'Christmas Day',
    country: 'US',
    month: 12,
    day: 25,
    greeting: 'Merry Christmas! May your holiday season be filled with peace, joy, and laughter.',
    visualTheme: 'Magnificent pine tree decorated in sparkling champagne gold ornaments and fairy lights, gently falling snow outside a luxury panoramic window, warm fireplace.',
    headlineTemplate: 'Wishing you a joyful, warm, and magical holiday season.',
    hashtags: ['#MerryChristmas', '#HolidaySeason', '#JoyAndPeace']
  },

  // --- UNITED ARAB EMIRATES (AE) ---
  {
    id: 'ae-national-day',
    name: 'UAE National Day',
    country: 'AE',
    month: 12,
    day: 2,
    greeting: 'Happy UAE National Day! Celebrating the spirit of the union, progress, and ambition.',
    visualTheme: 'UAE national flag proudly showcased, iconic Burj Khalifa and futuristic Dubai skyline bathed in celebratory lights, opulent gold accents.',
    headlineTemplate: 'Honoring the vision of the union, pioneering progress across the nation.',
    hashtags: ['#UAENationalDay', '#SpiritOfTheUnion', '#ProudUAE']
  },

  // --- GLOBAL (Applies to all countries) ---
  {
    id: 'global-new-year',
    name: "New Year's Day",
    country: 'GLOBAL',
    month: 1,
    day: 1,
    greeting: 'Happy New Year! Wishing you peace, abundance, and extraordinary success.',
    visualTheme: 'Golden clock striking midnight, sparkling starlight, luxurious champagne aesthetic with modern clean typography.',
    headlineTemplate: 'Embrace a fresh chapter filled with boundless potential.',
    hashtags: ['#HappyNewYear', '#NewBeginnings']
  },
  {
    id: 'global-christmas',
    name: 'Christmas',
    country: 'GLOBAL',
    month: 12,
    day: 25,
    greeting: 'Merry Christmas and season greetings to you and your loved ones!',
    visualTheme: 'Warm festive elegance, golden baubles, frosted pine branches, soft glowing fairy lights, premium modern holiday design.',
    headlineTemplate: 'Wishing you peace, cheer, and festive warmth.',
    hashtags: ['#MerryChristmas', '#SeasonsGreetings']
  }
];

/**
 * Normalize country input to match festival database.
 */
export function normalizeCountryCode(countryStr?: string | null): string {
  if (!countryStr) return 'IN'; // Default to India
  const clean = countryStr.trim().toUpperCase();

  if (clean === 'IN' || clean.includes('INDIA')) return 'IN';
  if (clean === 'US' || clean === 'USA' || clean.includes('UNITED STATES') || clean.includes('AMERICA')) return 'US';
  if (clean === 'AE' || clean === 'UAE' || clean.includes('EMIRATES') || clean.includes('DUBAI')) return 'AE';
  if (clean === 'GB' || clean === 'UK' || clean.includes('UNITED KINGDOM') || clean.includes('ENGLAND') || clean.includes('BRITAIN')) return 'GB';
  if (clean === 'CA' || clean.includes('CANADA')) return 'CA';
  if (clean === 'AU' || clean.includes('AUSTRALIA')) return 'AU';

  return 'IN';
}

/**
 * Check if today is a festival day in the given country.
 * Returns FestivalInfo or null.
 */
export function getFestivalForToday(countryInput?: string | null, targetDate?: Date): FestivalInfo | null {
  const countryCode = normalizeCountryCode(countryInput);
  const now = targetDate || new Date();

  // Determine current month and day in IST (or UTC)
  const month = now.getMonth() + 1;
  const day = now.getDate();

  // 1. Check exact country festivals
  const countryFestival = FESTIVALS_2026.find(
    f => f.country === countryCode && f.month === month && f.day === day
  );
  if (countryFestival) return countryFestival;

  // 2. Check global festivals
  const globalFestival = FESTIVALS_2026.find(
    f => f.country === 'GLOBAL' && f.month === month && f.day === day
  );
  if (globalFestival) return globalFestival;

  return null;
}

/**
 * Build bespoke prompt for festival image creative.
 * Strictly focuses on the business info, brand name, and the festival.
 * Does NOT generate for a specific project.
 */
export function buildFestivalCreativePrompt(params: {
  festival: FestivalInfo;
  businessName: string;
  businessInfo?: string;
  industry?: string;
  contactNumber?: string;
  logoUrl?: string;
}): string {
  const { festival, businessName, businessInfo, industry = 'general', contactNumber } = params;

  return `Create a breathtaking, luxurious festival greeting poster in 3:4 portrait aspect ratio celebrating ${festival.name}.
Brand: "${businessName}"
Industry: ${industry}
Brand Info: "${businessInfo || 'A premier business delivering excellence and trust'}"
Festival: "${festival.name}"
Visual Setting & Theme: ${festival.visualTheme}
Festive Greeting: "${festival.greeting}"
Headline: "${festival.headlineTemplate}"

### MANDATORY DESIGN INSTRUCTIONS:
- The graphic must be an authentic, prestigious FESTIVAL GREETING from the company "${businessName}".
- Do NOT feature any specific product or property inventory. The entire focus must be celebrating ${festival.name} infused with the prestige and identity of ${businessName}.
- Center stage: Artfully rendered cultural elements for ${festival.name} in warm, glowing, photorealistic detail with cinematic depth of field and soft ambient illumination.
- Include attractive, photorealistic South Asian / origin ethnicity humans (if depicted, such as a graceful family or professional) dressed in regal festive attire, radiating joy and warmth with authentic skin texture.
- Typography: Overlay an elegant, modern gold or crisp white greeting headline: "${festival.name}" in a regal serif or premium geometric font.
- Brand Integration: Seamlessly embed a tasteful monogram/logo watermark of "${businessName}" in the top corner.
- Bottom Margin: Display a clean, minimal footer with "${businessName}" and contact line "${contactNumber || ''}".
- Color Palette: Rich festive golds, deep jewel tones, warm ambient lighting, pristine luxury finish suitable for high-converting social media distribution.
- Do NOT output any markdown, explanations, or code. Deliver only the raw image design prompt.`;
}
