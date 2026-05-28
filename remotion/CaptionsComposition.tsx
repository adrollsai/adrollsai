import { AbsoluteFill, OffthreadVideo, useVideoConfig, useCurrentFrame, interpolate, spring } from 'remotion';
import React from 'react';
import { loadFont } from "@remotion/google-fonts/Montserrat";

// Ensure Montserrat is loaded for viral captions
loadFont();

export type Caption = {
    text: string;
    start: number;
    end: number;
    emphasis?: boolean;
};

export type Effect = {
    type: 'zoom' | 'emoji' | 'border' | 'shake';
    start: number;
    end: number;
    value?: string;
};

export type Theme = {
    fontFamily: string;
    fontSize: number;
    color: string;
    highlightColor: string;
    animation: 'pop' | 'fade' | 'slide';
    position: 'bottom' | 'center' | 'top';
    outlineColor?: string;
    glow?: boolean;
};

interface CaptionsCompositionProps {
    videoUrl: string;
    captions: Caption[];
    effects?: Effect[];
    theme: Theme;
    profile?: any;
}

export const CaptionsComposition: React.FC<CaptionsCompositionProps> = ({
    videoUrl,
    captions,
    effects = [],
    theme,
    profile = {}
}) => {
    const frame = useCurrentFrame();
    const { fps, durationInFrames } = useVideoConfig();

    // 4-second Outro screen (120 frames at 30fps)
    const outroDurationInFrames = 4 * fps;
    const originalDurationInFrames = durationInFrames - outroDurationInFrames;

    // Check if we are in the Outro phase
    const isOutro = frame >= originalDurationInFrames;

    if (isOutro) {
        return (
            <RemotionOutro 
                profile={profile} 
                theme={theme} 
                frame={frame - originalDurationInFrames} 
                fps={fps} 
            />
        );
    }

    // Active visual effects calculations
    const activeZoom = effects.find(eff => eff.type === 'zoom' && frame >= eff.start * fps && frame < eff.end * fps);
    const activeShake = effects.find(eff => eff.type === 'shake' && frame >= eff.start * fps && frame < eff.end * fps);
    const activeBorder = effects.find(eff => eff.type === 'border' && frame >= eff.start * fps && frame < eff.end * fps);
    const activeEmoji = effects.find(eff => eff.type === 'emoji' && frame >= eff.start * fps && frame < eff.end * fps);

    // 1. Zoom Transform (CSS scale)
    let scale = 1.0;
    if (activeZoom) {
        const zoomProgress = (frame - activeZoom.start * fps) / (activeZoom.end * fps - activeZoom.start * fps);
        scale = interpolate(zoomProgress, [0, 0.15, 0.85, 1.0], [1.0, 1.15, 1.15, 1.0], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp'
        });
    }

    // 2. Shake Transform (translation) - DISABLED to keep video stable and stable
    let translateX = 0;
    let translateY = 0;

    // 3. Glowing Neon Vignette border opacity
    let borderOpacity = 0;
    if (activeBorder) {
        borderOpacity = interpolate(Math.sin(frame * 0.18), [-1, 1], [0.35, 1.0]);
    }

    return (
        <AbsoluteFill style={{ backgroundColor: 'black' }}>
            {/* Background Video with Zoom & Shake transforms */}
            <div style={{
                width: '100%',
                height: '100%',
                transform: `scale(${scale}) translate(${translateX}px, ${translateY}px)`,
                position: 'absolute',
                inset: 0,
            }}>
                <OffthreadVideo src={videoUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>

            {/* Glowing Neon Vignette Border */}
            {activeBorder && (
                <div style={{
                    position: 'absolute',
                    inset: 0,
                    border: `12px solid ${theme.highlightColor || '#FFFF00'}`,
                    boxShadow: `inset 0 0 35px ${theme.highlightColor || '#FFFF00'}88, 0 0 35px ${theme.highlightColor || '#FFFF00'}88`,
                    pointerEvents: 'none',
                    zIndex: 5,
                    opacity: borderOpacity,
                }} />
            )}

            {/* Bouncy Spring Emoji Pop Layer */}
            {activeEmoji && activeEmoji.value && (
                <AbsoluteFill style={{
                    justifyContent: 'center',
                    alignItems: 'center',
                    zIndex: 8,
                    pointerEvents: 'none',
                    transform: 'translateY(120px)',
                }}>
                    <AnimatedEmoji 
                        emoji={activeEmoji.value} 
                        frame={frame - activeEmoji.start * fps} 
                        fps={fps} 
                    />
                </AbsoluteFill>
            )}

            {/* Captions Layer */}
            <AbsoluteFill style={{ 
                justifyContent: theme.position === 'bottom' ? 'flex-end' : theme.position === 'top' ? 'flex-start' : 'center',
                paddingBottom: theme.position === 'bottom' ? '18%' : '0',
                paddingTop: theme.position === 'top' ? '18%' : '0',
                // If position is center, translate down slightly to avoid center watermark/logo overlap
                transform: theme.position === 'center' ? 'translateY(280px)' : 'none',
                zIndex: 10,
            }}>
                <div style={{
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    textAlign: 'center',
                }}>
                    {captions.map((caption, i) => {
                        const startFrame = caption.start * fps;
                        const endFrame = caption.end * fps;
                        
                        if (frame >= startFrame && frame < endFrame) {
                            return (
                                <AnimatedCaption 
                                    key={i} 
                                    caption={caption} 
                                    theme={theme} 
                                    frame={frame} 
                                    fps={fps} 
                                    startFrame={startFrame}
                                />
                            );
                        }
                        return null;
                    })}
                </div>
            </AbsoluteFill>
        </AbsoluteFill>
    );
};

const AnimatedEmoji: React.FC<{ emoji: string; frame: number; fps: number }> = ({ emoji, frame, fps }) => {
    const scale = spring({
        frame,
        fps,
        config: { damping: 9, stiffness: 100 },
    });
    
    return (
        <div style={{
            fontSize: '180px',
            transform: `scale(${scale}) rotate(${Math.sin(frame * 0.12) * 12}deg)`,
            textShadow: '0 20px 45px rgba(0,0,0,0.6)',
        }}>
            {emoji}
        </div>
    );
};

const AnimatedCaption: React.FC<{ 
    caption: Caption, 
    theme: Theme, 
    frame: number, 
    fps: number, 
    startFrame: number 
}> = ({ caption, theme, frame, fps, startFrame }) => {
    const words = caption.text.split(" ");
    
    return (
        <div style={{
            fontSize: theme.fontSize || 96,
            fontFamily: '"Montserrat", "Arial Black", sans-serif',
            fontWeight: 900,
            textTransform: 'uppercase',
            padding: '0 40px',
            lineHeight: 1.0,
            letterSpacing: '-0.02em',
            WebkitTextStroke: '14px #000000',
            paintOrder: 'stroke fill',
            stroke: '#000000',
            strokeWidth: '14px',
            strokeLinejoin: 'round',
            display: 'inline-flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            filter: 'drop-shadow(0px 12px 12px rgba(0,0,0,0.75))',
        }}>
            {words.map((word, idx) => {
                let wordColor = theme.color || '#FFFFFF';
                if (caption.emphasis) {
                    // Hormozi-style alternating yellow (#FFE600) and neon green (#39FF14) highlights
                    wordColor = idx % 2 === 0 ? (theme.highlightColor || '#FFE600') : '#39FF14';
                }
                return (
                    <span 
                        key={idx} 
                        style={{ 
                            color: wordColor, 
                            marginRight: idx === words.length - 1 ? '0px' : '18px' 
                        }}
                    >
                        {word}
                    </span>
                );
            })}
        </div>
    );
};

const RemotionOutro: React.FC<{
    profile: any;
    theme: Theme;
    frame: number;
    fps: number;
}> = ({ profile, theme, frame, fps }) => {
    // Helper to check luminance of brand color
    const getLuminance = (hex: string) => {
        try {
            const color = hex.replace('#', '');
            if (color.length !== 6) return 0.5;
            const r = parseInt(color.substring(0, 2), 16) / 255;
            const g = parseInt(color.substring(2, 4), 16) / 255;
            const b = parseInt(color.substring(4, 6), 16) / 255;
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        } catch (e) {
            return 0.5;
        }
    };

    // Helper to darken a color for high contrast readability on white background
    const darkenColor = (hex: string, factor = 0.5) => {
        try {
            const color = hex.replace('#', '');
            if (color.length !== 6) return '#1e3a8a';
            const r = Math.max(0, Math.floor(parseInt(color.substring(0, 2), 16) * factor));
            const g = Math.max(0, Math.floor(parseInt(color.substring(2, 4), 16) * factor));
            const b = Math.max(0, Math.floor(parseInt(color.substring(4, 6), 16) * factor));
            return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
        } catch (e) {
            return '#1e3a8a';
        }
    };

    const displayBrandColor = profile?.brand_color || '#3b82f6';
    
    const opacity = spring({
        frame,
        fps,
        config: { damping: 14 },
    });
    
    const scale = spring({
        frame,
        fps,
        config: { damping: 11, stiffness: 75 },
    });

    const logoUrl = profile?.logo_url;
    const businessName = profile?.business_name || "AdRolls Partner";
    const contactNumber = profile?.contact_number;
    const address = profile?.address;

    // Dynamically retrieve subtitle from profile mission statement
    const missionStatement = profile?.mission_statement;
    const firstLineOfMission = missionStatement ? missionStatement.split('\n')[0].trim() : '';
    
    // Check if subtitle is redundant or doesn't make sense (e.g. contains 'about' or business name)
    const isRedundant = firstLineOfMission.toLowerCase().includes('about') || 
                        firstLineOfMission.toLowerCase().includes(businessName.toLowerCase()) || 
                        firstLineOfMission.toLowerCase() === 'mission statement';
                        
    const subtitle = isRedundant ? "" : firstLineOfMission;

    // Frame-based mathematics for floating dynamic background orbs
    const orb1X = Math.sin(frame * 0.02) * 80;
    const orb1Y = Math.cos(frame * 0.015) * 60;
    const orb2X = Math.cos(frame * 0.025) * 90;
    const orb2Y = Math.sin(frame * 0.02) * 70;
    const orb3X = Math.sin(frame * 0.018) * 110;
    const orb3Y = Math.cos(frame * 0.022) * 80;

    return (
        <AbsoluteFill style={{
            backgroundColor: '#F8FAFC', // Premium light off-white background
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#0F172A', // Dark high-contrast slate text
            fontFamily: 'Outfit, sans-serif',
            padding: '80px 60px',
            opacity,
            overflow: 'hidden',
        }}>
            {/* Dynamic Moving Orbs in the background */}
            <div style={{
                position: 'absolute',
                width: '750px',
                height: '750px',
                borderRadius: '50%',
                background: `radial-gradient(circle, ${displayBrandColor}28 0%, rgba(255,255,255,0) 70%)`,
                top: `calc(20% + ${orb1Y}px)`,
                left: `calc(15% + ${orb1X}px)`,
                filter: 'blur(40px)',
                zIndex: 0,
            }} />
            <div style={{
                position: 'absolute',
                width: '850px',
                height: '850px',
                borderRadius: '50%',
                background: `radial-gradient(circle, ${displayBrandColor}18 0%, rgba(255,255,255,0) 70%)`,
                top: `calc(55% + ${orb2Y}px)`,
                left: `calc(65% + ${orb2X}px)`,
                filter: 'blur(50px)',
                zIndex: 0,
            }} />
            <div style={{
                position: 'absolute',
                width: '650px',
                height: '650px',
                borderRadius: '50%',
                background: `radial-gradient(circle, #FFE60012 0%, rgba(255,255,255,0) 70%)`,
                top: `calc(80% + ${orb3Y}px)`,
                left: `calc(30% + ${orb3X}px)`,
                filter: 'blur(30px)',
                zIndex: 0,
            }} />

            <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                zIndex: 10,
                transform: `scale(${scale})`,
            }}>
                {logoUrl ? (
                    <img 
                        src={logoUrl} 
                        style={{
                            width: '270px',
                            height: '270px',
                            borderRadius: '54px',
                            objectFit: 'cover',
                            marginBottom: '45px',
                            boxShadow: `0 30px 60px ${displayBrandColor}22`,
                            border: `5px solid ${displayBrandColor}`,
                        }} 
                    />
                ) : (
                    <div style={{
                        width: '270px',
                        height: '270px',
                        borderRadius: '54px',
                        background: `linear-gradient(135deg, ${displayBrandColor} 0%, #1f2937 100%)`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '110px',
                        fontWeight: 'black',
                        marginBottom: '45px',
                        boxShadow: `0 30px 60px ${displayBrandColor}22`,
                        border: '5px solid rgba(0,0,0,0.05)',
                        color: 'white',
                    }}>
                        {businessName.charAt(0).toUpperCase()}
                    </div>
                )}

                <div style={{
                    width: '200px',
                    height: '6px',
                    background: '#1E293B', // Darker solid line for strong separator contrast
                    borderRadius: '4px',
                    marginBottom: '55px',
                    marginTop: '25px',
                }} />

                <div style={{ display: 'flex', flexDirection: 'column', gap: '30px', alignItems: 'center' }}>
                    {contactNumber && (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '16px',
                            fontSize: '60px',
                            fontWeight: 950, // Extra bold
                            color: '#0F172A',
                            textShadow: '0 2px 4px rgba(0,0,0,0.05)',
                        }}>
                            📞 <span style={{ color: '#0F172A' }}>{contactNumber}</span>
                        </div>
                    )}
                    {address && (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '14px',
                            fontSize: '36px',
                            fontWeight: 700,
                            color: '#1E293B', // Very bold and dark for readability
                            maxWidth: '820px',
                            lineHeight: 1.4,
                            textShadow: '0 1px 2px rgba(0,0,0,0.02)',
                        }}>
                            📍 {address}
                        </div>
                    )}
                </div>

            </div>
        </AbsoluteFill>
    );
};

