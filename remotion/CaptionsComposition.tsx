import { AbsoluteFill, OffthreadVideo, Audio, useVideoConfig, useCurrentFrame, interpolate, spring } from 'remotion';
import React from 'react';
import { loadFont as loadMontserrat } from "@remotion/google-fonts/Montserrat";
import { loadFont as loadOutfit } from "@remotion/google-fonts/Outfit";
import { loadFont as loadRoboto } from "@remotion/google-fonts/Roboto";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";

// Load Google Fonts for viral and professional captions
loadMontserrat();
loadOutfit();
loadRoboto();
loadInter();

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
    secondaryHighlightColor?: string;
    animation: 'pop' | 'bounce' | 'slide' | 'fade' | 'karaoke' | 'glitch' | 'zoom';
    position: 'bottom' | 'center' | 'top';
    verticalOffset?: number;
    outlineColor?: string;
    strokeWidth?: number;
    glow?: boolean;
    boxStyle?: 'none' | 'shadow' | 'badge' | 'glass';
    boxColor?: string;
    textTransform?: 'uppercase' | 'none' | 'capitalize';
};

interface CaptionsCompositionProps {
    videoUrl: string;
    audioUrl?: string;
    captions: Caption[];
    effects?: Effect[];
    theme: Theme;
    profile?: any;
}

export const CaptionsComposition: React.FC<CaptionsCompositionProps> = ({
    videoUrl,
    audioUrl,
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

    // 2. Shake Transform (translation) - DISABLED to keep video stable and clean
    let translateX = 0;
    let translateY = 0;

    // 3. Glowing Neon Vignette border opacity
    let borderOpacity = 0;
    if (activeBorder) {
        borderOpacity = interpolate(Math.sin(frame * 0.18), [-1, 1], [0.35, 1.0]);
    }

    const vertOffset = theme.verticalOffset || 0;

    return (
        <AbsoluteFill style={{ backgroundColor: 'black' }}>
            {/* Voiceover Audio Track */}
            {audioUrl && <Audio src={audioUrl} volume={1.0} />}

            {/* Background Video with Zoom & Shake transforms */}
            <div style={{
                width: '100%',
                height: '100%',
                transform: `scale(${scale}) translate(${translateX}px, ${translateY}px)`,
                position: 'absolute',
                inset: 0,
            }}>
                <OffthreadVideo 
                    src={videoUrl} 
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                    crossOrigin="anonymous" 
                    volume={audioUrl ? 0.1 : 1.0}
                />
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
                paddingBottom: theme.position === 'bottom' ? `calc(18% - ${vertOffset}px)` : '0',
                paddingTop: theme.position === 'top' ? `calc(18% + ${vertOffset}px)` : '0',
                transform: theme.position === 'center' ? `translateY(${280 + vertOffset}px)` : 'none',
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
                                    endFrame={endFrame}
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
    startFrame: number,
    endFrame: number
}> = ({ caption, theme, frame, fps, startFrame, endFrame }) => {
    const relFrame = Math.max(0, frame - startFrame);
    const durationInFrames = Math.max(1, endFrame - startFrame);
    const anim = theme.animation || 'pop';

    // Dynamic animation physics
    let animScale = 1.0;
    let animTranslateX = 0;
    let animTranslateY = 0;
    let animOpacity = 1.0;

    if (anim === 'pop') {
        const springVal = spring({
            frame: relFrame,
            fps,
            config: { damping: 11, stiffness: 220, mass: 0.6 }
        });
        animScale = interpolate(springVal, [0, 1], [0.75, 1.0]);
    } else if (anim === 'bounce') {
        const springVal = spring({
            frame: relFrame,
            fps,
            config: { damping: 9, stiffness: 180 }
        });
        animScale = interpolate(springVal, [0, 1], [0.85, 1.0]);
        animTranslateY = interpolate(springVal, [0, 1], [35, 0]);
    } else if (anim === 'slide') {
        animTranslateY = interpolate(relFrame, [0, 6], [45, 0], {
            extrapolateRight: 'clamp',
            extrapolateLeft: 'clamp'
        });
        animOpacity = interpolate(relFrame, [0, 4], [0, 1], {
            extrapolateRight: 'clamp',
            extrapolateLeft: 'clamp'
        });
    } else if (anim === 'fade') {
        animOpacity = interpolate(relFrame, [0, 6], [0, 1], {
            extrapolateRight: 'clamp',
            extrapolateLeft: 'clamp'
        });
    } else if (anim === 'zoom') {
        animScale = interpolate(relFrame, [0, 7], [0.5, 1.0], {
            extrapolateRight: 'clamp',
            extrapolateLeft: 'clamp'
        });
        animOpacity = interpolate(relFrame, [0, 4], [0, 1], {
            extrapolateRight: 'clamp',
            extrapolateLeft: 'clamp'
        });
    } else if (anim === 'glitch') {
        if (relFrame < 5) {
            animTranslateX = (relFrame % 2 === 0 ? 1 : -1) * (5 - relFrame) * 4;
            animTranslateY = (relFrame % 3 === 0 ? -1 : 1) * (5 - relFrame) * 2;
            animScale = 1.08;
        } else {
            animScale = 1.0;
        }
    }

    const words = caption.text.trim().split(/\s+/);
    const strokeWidth = theme.strokeWidth !== undefined ? theme.strokeWidth : 14;
    const strokeColor = theme.outlineColor || '#000000';
    const hasStroke = strokeWidth > 0;

    // Badges / Container styles
    const boxStyle = theme.boxStyle || 'none';
    let boxWrapperStyle: React.CSSProperties = {};
    if (boxStyle === 'badge') {
        boxWrapperStyle = {
            backgroundColor: theme.boxColor || 'rgba(0,0,0,0.85)',
            padding: '16px 36px',
            borderRadius: '32px',
            border: '3px solid rgba(255,255,255,0.18)',
            boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
        };
    } else if (boxStyle === 'glass') {
        boxWrapperStyle = {
            backgroundColor: 'rgba(15, 23, 42, 0.7)',
            backdropFilter: 'blur(20px)',
            padding: '16px 32px',
            borderRadius: '28px',
            border: '1.5px solid rgba(255,255,255,0.22)',
            boxShadow: '0 16px 32px rgba(0,0,0,0.4)',
        };
    } else if (boxStyle === 'shadow') {
        boxWrapperStyle = {
            padding: '8px 24px',
            filter: 'drop-shadow(0px 14px 20px rgba(0,0,0,0.85))',
        };
    }

    return (
        <div style={{
            transform: `scale(${animScale}) translate(${animTranslateX}px, ${animTranslateY}px)`,
            opacity: animOpacity,
            display: 'inline-flex',
            justifyContent: 'center',
            alignItems: 'center',
            maxWidth: '92%',
            ...boxWrapperStyle,
        }}>
            <div style={{
                fontSize: theme.fontSize || 96,
                fontFamily: `"${theme.fontFamily || 'Montserrat'}", "Outfit", "Inter", "Arial Black", sans-serif`,
                fontWeight: 900,
                textTransform: (theme.textTransform || 'uppercase') as any,
                padding: '0 16px',
                lineHeight: 1.05,
                letterSpacing: '-0.02em',
                WebkitTextStroke: hasStroke ? `${strokeWidth}px ${strokeColor}` : 'none',
                paintOrder: 'stroke fill',
                stroke: hasStroke ? strokeColor : undefined,
                strokeWidth: hasStroke ? `${strokeWidth}px` : undefined,
                strokeLinejoin: 'round',
                display: 'inline-flex',
                flexWrap: 'wrap',
                justifyContent: 'center',
                filter: theme.glow ? `drop-shadow(0px 0px 18px ${theme.highlightColor}66) drop-shadow(0px 12px 14px rgba(0,0,0,0.8))` : 'drop-shadow(0px 12px 14px rgba(0,0,0,0.75))',
            }}>
                {words.map((word, idx) => {
                    let wordColor = theme.color || '#FFFFFF';
                    let wordScale = 1.0;
                    let wordOpacity = 1.0;

                    if (anim === 'karaoke') {
                        // Word-by-word karaoke progression
                        const wordDuration = durationInFrames / Math.max(1, words.length);
                        const wordStart = startFrame + idx * wordDuration;
                        const wordEnd = startFrame + (idx + 1) * wordDuration;
                        const isCurrentWord = frame >= wordStart && frame < wordEnd;
                        const isPastWord = frame >= wordEnd;

                        if (isCurrentWord) {
                            wordColor = theme.highlightColor || '#FFE600';
                            wordScale = 1.15;
                            wordOpacity = 1.0;
                        } else if (isPastWord) {
                            wordColor = theme.secondaryHighlightColor || theme.highlightColor || '#FFE600';
                            wordOpacity = 0.95;
                        } else {
                            wordColor = theme.color || '#FFFFFF';
                            wordOpacity = 0.55; // Dim future words until spoken
                        }
                    } else if (caption.emphasis) {
                        wordColor = idx % 2 === 0 ? (theme.highlightColor || '#FFE600') : (theme.secondaryHighlightColor || '#39FF14');
                    }

                    return (
                        <span 
                            key={idx} 
                            style={{ 
                                color: wordColor, 
                                opacity: wordOpacity,
                                transform: wordScale !== 1.0 ? `scale(${wordScale})` : undefined,
                                transition: 'all 0.1s ease',
                                marginRight: idx === words.length - 1 ? '0px' : '18px',
                                display: 'inline-block'
                            }}
                        >
                            {word}
                        </span>
                    );
                })}
            </div>
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
    
    const opacity = interpolate(frame, [0, 15], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    });

    const logoUrl = profile?.logo_url;
    const businessName = profile?.business_name || "Nobogent Partner";
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
            }}>
                {logoUrl ? (
                    <img 
                        src={logoUrl} 
                        style={{
                            width: '260px',
                            height: '260px',
                            borderRadius: '52px',
                            objectFit: 'contain',
                            backgroundColor: '#FFFFFF',
                            padding: '20px',
                            marginBottom: '28px',
                            boxShadow: `0 30px 60px ${displayBrandColor}22`,
                            border: `5px solid ${displayBrandColor}`,
                        }} 
                    />
                ) : (
                    <div style={{
                        width: '260px',
                        height: '260px',
                        borderRadius: '52px',
                        background: `linear-gradient(135deg, ${displayBrandColor} 0%, #1f2937 100%)`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '100px',
                        fontWeight: 900,
                        marginBottom: '28px',
                        boxShadow: `0 30px 60px ${displayBrandColor}22`,
                        border: '5px solid rgba(0,0,0,0.05)',
                        color: 'white',
                    }}>
                        {businessName.charAt(0).toUpperCase()}
                    </div>
                )}

                {/* Company Name */}
                <h1 style={{
                    fontSize: '62px',
                    fontWeight: 900,
                    color: '#0F172A',
                    margin: '0 0 10px 0',
                    letterSpacing: '-1px',
                    lineHeight: 1.15,
                    maxWidth: '880px',
                    textTransform: 'uppercase',
                }}>
                    {businessName}
                </h1>

                {/* Mission / Tagline Subtitle if present */}
                {subtitle && (
                    <p style={{
                        fontSize: '28px',
                        fontWeight: 600,
                        color: '#64748B',
                        margin: '0 0 10px 0',
                        maxWidth: '820px',
                        lineHeight: 1.35,
                    }}>
                        {subtitle}
                    </p>
                )}

                {/* Separator Line */}
                <div style={{
                    width: '180px',
                    height: '6px',
                    background: displayBrandColor || '#1E293B',
                    borderRadius: '4px',
                    marginBottom: '40px',
                    marginTop: '20px',
                }} />

                <div style={{ display: 'flex', flexDirection: 'column', gap: '26px', alignItems: 'center' }}>
                    {contactNumber && (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '16px',
                            fontSize: '56px',
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

