import { AbsoluteFill, Video, useVideoConfig, useCurrentFrame, interpolate, spring } from 'remotion';
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

    // 2. Shake Transform (translation)
    let translateX = 0;
    let translateY = 0;
    if (activeShake) {
        translateX = Math.sin(frame * 1.6) * 10;
        translateY = Math.cos(frame * 1.9) * 10;
    }

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
                <Video src={videoUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
    const brandColor = profile?.brand_color || '#3b82f6';
    
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

    return (
        <AbsoluteFill style={{
            backgroundColor: '#FFFFFF',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#111827',
            fontFamily: 'Outfit, sans-serif',
            padding: '60px 40px',
            opacity,
        }}>
            <div style={{
                position: 'absolute',
                width: '650px',
                height: '650px',
                borderRadius: '50%',
                background: `radial-gradient(circle, ${brandColor}15 0%, rgba(255,255,255,0) 70%)`,
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
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
                            width: '190px',
                            height: '190px',
                            borderRadius: '36px',
                            objectFit: 'cover',
                            marginBottom: '35px',
                            boxShadow: `0 20px 45px ${brandColor}44`,
                            border: `4px solid ${brandColor}`,
                        }} 
                    />
                ) : (
                    <div style={{
                        width: '190px',
                        height: '190px',
                        borderRadius: '36px',
                        background: `linear-gradient(135deg, ${brandColor} 0%, #1f2937 100%)`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '76px',
                        fontWeight: 'black',
                        marginBottom: '35px',
                        boxShadow: `0 20px 45px ${brandColor}33`,
                        border: '4px solid rgba(0,0,0,0.06)',
                        color: 'white',
                    }}>
                        {businessName.charAt(0).toUpperCase()}
                    </div>
                )}

                <h1 style={{
                    fontSize: '66px',
                    fontWeight: 900,
                    marginBottom: '15px',
                    letterSpacing: '-0.04em',
                    textTransform: 'uppercase',
                    background: `linear-gradient(to right, #111827, ${brandColor})`,
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    lineHeight: 1.1,
                }}>
                    {businessName}
                </h1>

                <p style={{
                    fontSize: '26px',
                    color: '#4b5563',
                    fontWeight: 600,
                    marginBottom: '45px',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                }}>
                    Creative Marketing Partner
                </p>

                <div style={{
                    width: '130px',
                    height: '5px',
                    background: brandColor,
                    borderRadius: '3px',
                    marginBottom: '45px',
                }} />

                <div style={{ display: 'flex', flexDirection: 'column', gap: '22px', alignItems: 'center' }}>
                    {contactNumber && (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            fontSize: '44px',
                            fontWeight: 800,
                            color: '#1f2937',
                        }}>
                            📞 <span style={{ color: brandColor }}>{contactNumber}</span>
                        </div>
                    )}
                    {address && (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            fontSize: '28px',
                            fontWeight: 500,
                            color: '#4b5563',
                            maxWidth: '680px',
                            lineHeight: 1.4,
                        }}>
                            📍 {address}
                        </div>
                    )}
                </div>

            </div>
        </AbsoluteFill>
    );
};

