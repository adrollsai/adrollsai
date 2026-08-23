export interface VobizAvailableNumber {
    phoneNumber: string
    formattedNumber: string
    region: string
    state: string
    type: 'Local' | 'Toll-Free' | 'Mobile'
    monthlyRental: number // in INR / credits
    capabilities: {
        voice: boolean
        sms: boolean
        bidirectional: boolean
    }
    isPopular?: boolean
}

// Available pool of Indian Vobiz virtual numbers for instant one-click assignment
export const VOBIZ_NUMBER_CATALOG: VobizAvailableNumber[] = [
    {
        phoneNumber: '+911171366938',
        formattedNumber: '+91 11 7136 6938',
        region: 'Delhi NCR',
        state: 'Delhi',
        type: 'Local',
        monthlyRental: 499,
        capabilities: { voice: true, sms: true, bidirectional: true },
        isPopular: true
    },
    {
        phoneNumber: '+912269874521',
        formattedNumber: '+91 22 6987 4521',
        region: 'Mumbai',
        state: 'Maharashtra',
        type: 'Local',
        monthlyRental: 499,
        capabilities: { voice: true, sms: true, bidirectional: true },
        isPopular: true
    },
    {
        phoneNumber: '+918069542133',
        formattedNumber: '+91 80 6954 2133',
        region: 'Bengaluru',
        state: 'Karnataka',
        type: 'Local',
        monthlyRental: 499,
        capabilities: { voice: true, sms: true, bidirectional: true },
        isPopular: true
    },
    {
        phoneNumber: '+914069321455',
        formattedNumber: '+91 40 6932 1455',
        region: 'Hyderabad',
        state: 'Telangana',
        type: 'Local',
        monthlyRental: 499,
        capabilities: { voice: true, sms: true, bidirectional: true }
    },
    {
        phoneNumber: '+911247129840',
        formattedNumber: '+91 124 7129 840',
        region: 'Gurugram',
        state: 'Haryana',
        type: 'Local',
        monthlyRental: 499,
        capabilities: { voice: true, sms: true, bidirectional: true }
    },
    {
        phoneNumber: '+912071853920',
        formattedNumber: '+91 20 7185 3920',
        region: 'Pune',
        state: 'Maharashtra',
        type: 'Local',
        monthlyRental: 499,
        capabilities: { voice: true, sms: true, bidirectional: true }
    }
]
