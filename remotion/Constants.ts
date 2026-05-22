import { Theme } from "./CaptionsComposition";

export const SUBTITLE_THEMES: Record<string, Theme> = {
    hormozi: {
        fontFamily: 'Inter',
        fontSize: 84,
        color: '#FFFFFF',
        highlightColor: '#FFFF00', // Bright Yellow
        animation: 'pop',
        position: 'center',
        glow: true,
        outlineColor: '#000000'
    },
    boldViral: {
        fontFamily: 'Outfit',
        fontSize: 90,
        color: '#FFFFFF',
        highlightColor: '#00EAFF', // Cyber Blue
        animation: 'pop',
        position: 'bottom',
        glow: true,
        outlineColor: '#000000'
    },
    minimal: {
        fontFamily: 'Roboto',
        fontSize: 64,
        color: '#FFFFFF',
        highlightColor: '#FFFFFF',
        animation: 'fade',
        position: 'bottom',
        glow: false
    },
    neonCreator: {
        fontFamily: 'Inter',
        fontSize: 80,
        color: '#FFFFFF',
        highlightColor: '#FF00FF', // Neon Pink
        animation: 'pop',
        position: 'center',
        glow: true
    }
};
