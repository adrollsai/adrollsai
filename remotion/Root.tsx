import React from "react";
import { Composition } from "remotion";
import { CaptionsComposition } from "./CaptionsComposition";
import { StitchComposition } from "./StitchComposition";

export const RemotionRoot: React.FC = () => {
    return (
        <>
            <Composition
                id="CaptionsComposition"
                component={CaptionsComposition as any}
                durationInFrames={30 * 30} // Default 30 seconds
                fps={30}
                width={1080}
                height={1920}
                defaultProps={{
                    videoUrl: "",
                    captions: [],
                    theme: {
                        fontFamily: 'Inter',
                        fontSize: 80,
                        color: '#FFFFFF',
                        highlightColor: '#FFFF00',
                        animation: 'pop',
                        position: 'center'
                    }
                }}
            />
            <Composition
                id="StitchComposition"
                component={StitchComposition as any}
                durationInFrames={30 * 30} // Overridden dynamically at render time
                fps={30}
                width={1080}
                height={1920}
                defaultProps={{
                    videoUrls: [] as string[],
                    audioUrl: "",
                    clipDurationInSeconds: 15
                }}
            />
        </>
    );
};
