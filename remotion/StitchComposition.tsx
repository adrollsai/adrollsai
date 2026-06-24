import { Series, OffthreadVideo, AbsoluteFill } from 'remotion';
import React from 'react';

interface StitchCompositionProps {
    videoUrls: string[];
}

export const StitchComposition: React.FC<StitchCompositionProps> = ({ videoUrls }) => {
    return (
        <AbsoluteFill style={{ backgroundColor: 'black' }}>
            <Series>
                {videoUrls.map((url, index) => (
                    <Series.Sequence key={index} durationInFrames={15 * 30}>
                        <OffthreadVideo 
                            src={url} 
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                        />
                    </Series.Sequence>
                ))}
            </Series>
        </AbsoluteFill>
    );
};
