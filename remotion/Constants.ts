import { Theme } from "./CaptionsComposition";

export const SUBTITLE_THEMES: Record<string, Theme> = {
    hormozi: {
        fontFamily: 'Montserrat',
        fontSize: 92,
        color: '#FFFFFF',
        highlightColor: '#FFE600', // Alex Hormozi Yellow
        secondaryHighlightColor: '#39FF14', // Neon Lime
        animation: 'pop',
        position: 'center',
        glow: true,
        strokeWidth: 14,
        outlineColor: '#000000',
        boxStyle: 'none'
    },
    boldViral: {
        fontFamily: 'Outfit',
        fontSize: 88,
        color: '#FFFFFF',
        highlightColor: '#00EAFF', // Cyber Blue
        secondaryHighlightColor: '#FFE600',
        animation: 'bounce',
        position: 'bottom',
        glow: true,
        strokeWidth: 12,
        outlineColor: '#000000',
        boxStyle: 'shadow'
    },
    beastBox: {
        fontFamily: 'Montserrat',
        fontSize: 84,
        color: '#FFFFFF',
        highlightColor: '#FFE600',
        secondaryHighlightColor: '#00FF66',
        animation: 'pop',
        position: 'bottom',
        glow: false,
        strokeWidth: 0,
        boxStyle: 'badge',
        boxColor: 'rgba(10, 10, 15, 0.88)'
    },
    karaokeHype: {
        fontFamily: 'Outfit',
        fontSize: 86,
        color: '#E2E8F0',
        highlightColor: '#39FF14', // Electric Lime
        secondaryHighlightColor: '#00EAFF',
        animation: 'karaoke',
        position: 'bottom',
        glow: true,
        strokeWidth: 12,
        outlineColor: '#000000',
        boxStyle: 'glass'
    },
    neonCreator: {
        fontFamily: 'Montserrat',
        fontSize: 84,
        color: '#FFFFFF',
        highlightColor: '#FF007F', // Neon Magenta
        secondaryHighlightColor: '#00F0FF', // Neon Cyan
        animation: 'glitch',
        position: 'center',
        glow: true,
        strokeWidth: 12,
        outlineColor: '#0f051d',
        boxStyle: 'none'
    },
    goldenLuxury: {
        fontFamily: 'Outfit',
        fontSize: 82,
        color: '#F8FAFC',
        highlightColor: '#F59E0B', // Amber Gold
        secondaryHighlightColor: '#FBBF24',
        animation: 'slide',
        position: 'bottom',
        glow: true,
        strokeWidth: 8,
        outlineColor: '#1e1503',
        boxStyle: 'shadow'
    },
    crimsonAlert: {
        fontFamily: 'Montserrat',
        fontSize: 90,
        color: '#FFFFFF',
        highlightColor: '#EF4444', // Crimson Red
        secondaryHighlightColor: '#FBBF24',
        animation: 'zoom',
        position: 'center',
        glow: true,
        strokeWidth: 14,
        outlineColor: '#000000',
        boxStyle: 'none'
    },
    minimal: {
        fontFamily: 'Roboto',
        fontSize: 66,
        color: '#FFFFFF',
        highlightColor: '#38BDF8',
        secondaryHighlightColor: '#FFFFFF',
        animation: 'fade',
        position: 'bottom',
        glow: false,
        strokeWidth: 0,
        boxStyle: 'glass',
        boxColor: 'rgba(15, 23, 42, 0.65)'
    }
};

export const ANIMATION_OPTIONS: { id: Theme['animation']; label: string; icon: string; description: string }[] = [
    { id: 'pop', label: 'Pop Spring', icon: '💥', description: 'Punchy scale spring pop (Hormozi / Reels style)' },
    { id: 'bounce', label: 'Bounce', icon: '⚡', description: 'Energetic vertical bounce with spring dynamics' },
    { id: 'slide', label: 'Slide Up', icon: '🚀', description: 'Smooth upward glide into position' },
    { id: 'fade', label: 'Fade In', icon: '✨', description: 'Clean, elegant opacity transition' },
    { id: 'karaoke', label: 'Karaoke Sync', icon: '🎤', description: 'Active word-by-word highlight wave' },
    { id: 'glitch', label: 'Glitch Jitter', icon: '👾', description: 'High-impact kinetic shake & glitch' },
    { id: 'zoom', label: 'Zoom In', icon: '🔍', description: 'Dramatic scale zoom into focus' },
];
