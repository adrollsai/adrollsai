import { Series, OffthreadVideo, AbsoluteFill, Audio } from 'remotion';
import React from 'react';

interface StitchCompositionProps {
    videoUrls: string[];
    audioUrl?: string;
    clipDurationInSeconds?: number;
    /** Per-clip durations (seconds). Takes precedence over clipDurationInSeconds if provided. */
    clipDurationsInSeconds?: number[];
}

export const StitchComposition: React.FC<StitchCompositionProps> = ({
    videoUrls,
    audioUrl,
    clipDurationInSeconds = 15,
    clipDurationsInSeconds
}) => {
    return (
        <AbsoluteFill style={{ backgroundColor: 'black' }}>
            <Series>
                {videoUrls.map((url, index) => {
                    const durSec = clipDurationsInSeconds?.[index] ?? clipDurationInSeconds;
                    const frameCount = Math.max(30, Math.round(durSec * 30));
                    return (
                        <Series.Sequence key={index} durationInFrames={frameCount}>
                            <OffthreadVideo
                                src={url}
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                volume={audioUrl ? 0.1 : 1.0}
                            />
                        </Series.Sequence>
                    );
                })}
            </Series>
            {audioUrl && <Audio src={audioUrl} volume={1.0} />}
        </AbsoluteFill>
    );
};
