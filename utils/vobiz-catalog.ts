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

// Available pool of Indian Vobiz 79-series virtual numbers for client claiming
export const VOBIZ_NUMBER_CATALOG: VobizAvailableNumber[] = [
    {
        phoneNumber: '+917949123456',
        formattedNumber: '+91 79 4912 3456',
        region: '79 Series Virtual Line',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        isPopular: true
    },
    {
        phoneNumber: '+917969874521',
        formattedNumber: '+91 79 6987 4521',
        region: '79 Series Virtual Line',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        isPopular: true
    },
    {
        phoneNumber: '+917971366938',
        formattedNumber: '+91 79 7136 6938',
        region: '79 Series Virtual Line',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true },
        isPopular: true
    },
    {
        phoneNumber: '+917980695421',
        formattedNumber: '+91 79 8069 5421',
        region: '79 Series Virtual Line',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true }
    },
    {
        phoneNumber: '+917935214550',
        formattedNumber: '+91 79 3521 4550',
        region: '79 Series Virtual Line',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true }
    },
    {
        phoneNumber: '+917971298401',
        formattedNumber: '+91 79 7129 8401',
        region: '79 Series Virtual Line',
        state: 'India',
        type: 'Local',
        monthlyRental: 0,
        capabilities: { voice: true, sms: true, bidirectional: true }
    }
]
