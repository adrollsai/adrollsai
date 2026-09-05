export interface VobizAvailableNumber {
    phoneNumber: string
    formattedNumber: string
    region: string
    state: string
    type: 'Local' | 'Toll-Free' | 'Mobile'
    monthlyRental: number // in INR / credits (0 = free included in package)
    capabilities: {
        voice: boolean
        sms: boolean
        bidirectional: boolean
    }
    isPopular?: boolean
    category?: 'VIP' | 'Easy Recall' | 'Standard'
}

export function formatIndianPhoneNumber(num: string): string {
    const clean = num.replace(/\D/g, '')
    if (clean.length === 12 && clean.startsWith('91')) {
        return `+91 ${clean.slice(2, 4)} ${clean.slice(4, 8)} ${clean.slice(8)}`
    }
    if (clean.length === 10) {
        return `+91 ${clean.slice(0, 2)} ${clean.slice(2, 6)} ${clean.slice(6)}`
    }
    return num.startsWith('+') ? num : `+${num}`
}

export function classifyNumberPattern(num: string): 'VIP' | 'Easy Recall' | 'Standard' {
    const digits = num.replace(/\D/g, '')
    const local = digits.slice(-8)
    
    // VIP: triples (777, 888, 000), ending with 00/000, or repeating 2-digit pairs at the end
    if (/(\d)\1\1/.test(local) || /(\d{2})\1$/.test(local) || /00$/.test(local)) {
        return 'VIP'
    }
    
    // Easy Recall: consecutive ascending/descending runs, duplicate pairs (e.g. 44, 55, 88)
    if (/012|123|234|345|456|567|678|789|987|876|765|654|543|432|321/.test(local) || /(\d)\1/.test(local)) {
        return 'Easy Recall'
    }

    return 'Standard'
}

// Available comprehensive pool of Indian Vobiz 79-series virtual numbers for client claiming
export const VOBIZ_NUMBER_CATALOG: VobizAvailableNumber[] = [
    // Featured / Original Pool
    {
        phoneNumber: '+917949123456',
        formattedNumber: '+91 79 4912 3456',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        isPopular: true,
        category: 'Easy Recall'
    },
    {
        phoneNumber: '+917969874521',
        formattedNumber: '+91 79 6987 4521',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        isPopular: true,
        category: 'Easy Recall'
    },
    {
        phoneNumber: '+917971366938',
        formattedNumber: '+91 79 7136 6938',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        isPopular: true,
        category: 'Easy Recall'
    },
    {
        phoneNumber: '+917980695421',
        formattedNumber: '+91 79 8069 5421',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917935214550',
        formattedNumber: '+91 79 3521 4550',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917971298401',
        formattedNumber: '+91 79 7129 8401',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },

    // VIP & Golden Patterns
    {
        phoneNumber: '+917940008800',
        formattedNumber: '+91 79 4000 8800',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        isPopular: true,
        category: 'VIP'
    },
    {
        phoneNumber: '+917970709090',
        formattedNumber: '+91 79 7070 9090',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        isPopular: true,
        category: 'VIP'
    },
    {
        phoneNumber: '+917966005500',
        formattedNumber: '+91 79 6600 5500',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        isPopular: true,
        category: 'VIP'
    },
    {
        phoneNumber: '+917945009900',
        formattedNumber: '+91 79 4500 9900',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        isPopular: true,
        category: 'VIP'
    },
    {
        phoneNumber: '+917930308080',
        formattedNumber: '+91 79 3030 8080',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        isPopular: true,
        category: 'VIP'
    },
    {
        phoneNumber: '+917971714444',
        formattedNumber: '+91 79 7171 4444',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        isPopular: true,
        category: 'VIP'
    },
    {
        phoneNumber: '+917969695050',
        formattedNumber: '+91 79 6969 5050',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        isPopular: true,
        category: 'VIP'
    },
    {
        phoneNumber: '+917948881212',
        formattedNumber: '+91 79 4888 1212',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        isPopular: true,
        category: 'VIP'
    },
    {
        phoneNumber: '+917933221100',
        formattedNumber: '+91 79 3322 1100',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        isPopular: true,
        category: 'VIP'
    },
    {
        phoneNumber: '+917977889900',
        formattedNumber: '+91 79 7788 9900',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        isPopular: true,
        category: 'VIP'
    },
    {
        phoneNumber: '+917955443322',
        formattedNumber: '+91 79 5544 3322',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        isPopular: true,
        category: 'VIP'
    },
    {
        phoneNumber: '+917968007700',
        formattedNumber: '+91 79 6800 7700',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        isPopular: true,
        category: 'VIP'
    },
    {
        phoneNumber: '+917940406060',
        formattedNumber: '+91 79 4040 6060',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        isPopular: true,
        category: 'VIP'
    },
    {
        phoneNumber: '+917977001100',
        formattedNumber: '+91 79 7700 1100',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        isPopular: true,
        category: 'VIP'
    },
    {
        phoneNumber: '+917988002200',
        formattedNumber: '+91 79 8800 2200',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        isPopular: true,
        category: 'VIP'
    },
    {
        phoneNumber: '+917999003300',
        formattedNumber: '+91 79 9900 3300',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        isPopular: true,
        category: 'VIP'
    },

    // Easy Recall Pool
    {
        phoneNumber: '+917942105520',
        formattedNumber: '+91 79 4210 5520',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Easy Recall'
    },
    {
        phoneNumber: '+917961234500',
        formattedNumber: '+91 79 6123 4500',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        isPopular: true,
        category: 'Easy Recall'
    },
    {
        phoneNumber: '+917972458910',
        formattedNumber: '+91 79 7245 8910',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Easy Recall'
    },
    {
        phoneNumber: '+917983127400',
        formattedNumber: '+91 79 8312 7400',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Easy Recall'
    },
    {
        phoneNumber: '+917949506120',
        formattedNumber: '+91 79 4950 6120',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Easy Recall'
    },
    {
        phoneNumber: '+917968213940',
        formattedNumber: '+91 79 6821 3940',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Easy Recall'
    },
    {
        phoneNumber: '+917973104820',
        formattedNumber: '+91 79 7310 4820',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Easy Recall'
    },
    {
        phoneNumber: '+917984501930',
        formattedNumber: '+91 79 8450 1930',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Easy Recall'
    },
    {
        phoneNumber: '+917941203850',
        formattedNumber: '+91 79 4120 3850',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Easy Recall'
    },
    {
        phoneNumber: '+917962304910',
        formattedNumber: '+91 79 6230 4910',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Easy Recall'
    },
    {
        phoneNumber: '+917974502810',
        formattedNumber: '+91 79 7450 2810',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Easy Recall'
    },
    {
        phoneNumber: '+917985603720',
        formattedNumber: '+91 79 8560 3720',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Easy Recall'
    },
    {
        phoneNumber: '+917946701820',
        formattedNumber: '+91 79 4670 1820',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Easy Recall'
    },
    {
        phoneNumber: '+917967802930',
        formattedNumber: '+91 79 6780 2930',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Easy Recall'
    },
    {
        phoneNumber: '+917978903040',
        formattedNumber: '+91 79 7890 3040',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Easy Recall'
    },
    {
        phoneNumber: '+917989014150',
        formattedNumber: '+91 79 8901 4150',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Easy Recall'
    },

    // Standard Pool
    {
        phoneNumber: '+917943217890',
        formattedNumber: '+91 79 4321 7890',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917965432190',
        formattedNumber: '+91 79 6543 2190',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917976543210',
        formattedNumber: '+91 79 7654 3210',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917987654320',
        formattedNumber: '+91 79 8765 4320',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917941098760',
        formattedNumber: '+91 79 4109 8760',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917962109870',
        formattedNumber: '+91 79 6210 9870',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917973210980',
        formattedNumber: '+91 79 7321 0980',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917984321090',
        formattedNumber: '+91 79 8432 1090',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917945671230',
        formattedNumber: '+91 79 4567 1230',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917967892340',
        formattedNumber: '+91 79 6789 2340',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917978903450',
        formattedNumber: '+91 79 7890 3450',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917989014560',
        formattedNumber: '+91 79 8901 4560',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917941289304',
        formattedNumber: '+91 79 4128 9304',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917962390415',
        formattedNumber: '+91 79 6239 0415',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917973401526',
        formattedNumber: '+91 79 7340 1526',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917984512637',
        formattedNumber: '+91 79 8451 2637',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917945623748',
        formattedNumber: '+91 79 4562 3748',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917966734859',
        formattedNumber: '+91 79 6673 4859',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917977845960',
        formattedNumber: '+91 79 7784 5960',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917988956071',
        formattedNumber: '+91 79 8895 6071',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917949067182',
        formattedNumber: '+91 79 4906 7182',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917960178293',
        formattedNumber: '+91 79 6017 8293',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917971289304',
        formattedNumber: '+91 79 7128 9304',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917982390415',
        formattedNumber: '+91 79 8239 0415',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917943501526',
        formattedNumber: '+91 79 4350 1526',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917964612637',
        formattedNumber: '+91 79 6461 2637',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917975723748',
        formattedNumber: '+91 79 7572 3748',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917986834859',
        formattedNumber: '+91 79 8683 4859',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917947945960',
        formattedNumber: '+91 79 4794 5960',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917968056071',
        formattedNumber: '+91 79 6805 6071',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917979167182',
        formattedNumber: '+91 79 7916 7182',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917980278293',
        formattedNumber: '+91 79 8027 8293',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917941389405',
        formattedNumber: '+91 79 4138 9405',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917962490516',
        formattedNumber: '+91 79 6249 0516',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917973501627',
        formattedNumber: '+91 79 7350 1627',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917984612738',
        formattedNumber: '+91 79 8461 2738',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917945723849',
        formattedNumber: '+91 79 4572 3849',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917966834950',
        formattedNumber: '+91 79 6683 4950',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917977945061',
        formattedNumber: '+91 79 7794 5061',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917988056172',
        formattedNumber: '+91 79 8805 6172',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917949167283',
        formattedNumber: '+91 79 4916 7283',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917960278394',
        formattedNumber: '+91 79 6027 8394',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917971389405',
        formattedNumber: '+91 79 7138 9405',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917982490516',
        formattedNumber: '+91 79 8249 0516',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917943601627',
        formattedNumber: '+91 79 4360 1627',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917964712738',
        formattedNumber: '+91 79 6471 2738',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917975823849',
        formattedNumber: '+91 79 7582 3849',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917986934950',
        formattedNumber: '+91 79 8693 4950',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917947045061',
        formattedNumber: '+91 79 4704 5061',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    },
    {
        phoneNumber: '+917968156172',
        formattedNumber: '+91 79 6815 6172',
        region: '79-Series',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        category: 'Standard'
    }
]
