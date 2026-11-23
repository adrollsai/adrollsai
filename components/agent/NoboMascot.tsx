'use client';

import * as React from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Sparkles } from 'lucide-react';

/**
 * Nobo — the mascot.
 *
 * A glowing gradient orb with two eyes: friendly, expressive, and cheap to render
 * (pure SVG, no image request). It replaced a static JPEG avatar, which could
 * never look at you, blink, or show that the agent was thinking.
 *
 * Behaviour is driven by `state`, which the chat sets from the run:
 *   idle      breathing float, slow blink, eyes drift a little
 *   thinking  brisker bob, orbiting highlight, eyes glance up (it is concentrating)
 *   talking   lively pulse while a reply streams
 *   success   one cheerful hop with a sparkle
 *
 * Everything is `prefers-reduced-motion`-aware: with motion reduced, the orb is
 * still drawn in full but stops moving. Purely decorative, so it is `aria-hidden`
 * unless it carries a `message` to announce.
 */

export type NoboState = 'idle' | 'thinking' | 'success' | 'talking';
export type NoboSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface NoboMascotProps {
  state?: NoboState;
  /** Speech bubble text beside the orb. */
  message?: string;
  size?: NoboSize;
  className?: string;
  /** Overrides the accessible label. Defaults to a per-state sentence. */
  label?: string;
}

const SIZE_PX: Record<NoboSize, number> = { xs: 22, sm: 36, md: 60, lg: 96, xl: 148 };

const STATE_LABEL: Record<NoboState, string> = {
  idle: 'Nobo, your marketing assistant',
  thinking: 'Nobo is working on it',
  talking: 'Nobo is replying',
  success: 'Nobo finished',
};

const EYE_WIDTH: Record<NoboSize, number> = { xs: 4.1, sm: 6.2, md: 8.8, lg: 12.8, xl: 18.4 };

/**
 * The orb itself, without a wrapper. Exported because the assistant avatar in the
 * transcript needs the same face at a tiny size.
 */
export function NoboOrb({
  size = 'md',
  state = 'idle',
  className = '',
}: {
  size?: NoboSize;
  state?: NoboState;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const px = SIZE_PX[size];
  const eyeW = EYE_WIDTH[size];
  const eyeH = eyeW * 1.52;
  const [blink, setBlink] = React.useState(false);

  // A blink is a state change rather than a keyframe loop, so the rhythm stays
  // irregular — a metronome blink reads as a machine.
  React.useEffect(() => {
    if (reduced) return;
    let timers: ReturnType<typeof setTimeout>[] = [];
    let alive = true;

    const schedule = () => {
      const wait = 2600 + Math.random() * 3600;
      timers.push(
        setTimeout(() => {
          if (!alive) return;
          setBlink(true);
          timers.push(
            setTimeout(() => {
              if (!alive) return;
              setBlink(false);
              schedule();
            }, 130)
          );
        }, wait)
      );
    };
    schedule();

    return () => {
      alive = false;
      timers.forEach(clearTimeout);
      timers = [];
    };
  }, [reduced]);

  const isThinking = state === 'thinking';
  const isTalking = state === 'talking';
  const isSuccess = state === 'success';

  const float = reduced
    ? {}
    : isThinking
      ? { y: [0, -4, 0], scale: [1, 1.02, 1] }
      : isTalking
        ? { y: [0, -2.5, 0], scale: [1, 1.03, 1] }
        : { y: [0, -5, 0] };

  const floatTiming = reduced
    ? { duration: 0 }
    : isThinking
      ? { duration: 1.1, repeat: Infinity, ease: 'easeInOut' as const }
      : isTalking
        ? { duration: 0.85, repeat: Infinity, ease: 'easeInOut' as const }
        : { duration: 4.2, repeat: Infinity, ease: 'easeInOut' as const };

  // Ids must be unique per size so several orbs on one page keep their own paint
  // server, otherwise the last definition wins and every orb shares one gradient.
  const uid = React.useId().replace(/:/g, '');
  const id = (name: string) => `nobo-${name}-${uid}`;

  return (
    <motion.div
      className={`relative shrink-0 ${className}`}
      style={{ width: px, height: px }}
      animate={isSuccess && !reduced ? { y: [0, -px * 0.16, 0], scale: [1, 1.06, 1] } : float}
      transition={isSuccess && !reduced ? { duration: 0.55, ease: 'easeOut' } : floatTiming}
    >
      {/* Ambient glow — makes the orb feel lit from inside rather than pasted on.
          Skipped at avatar sizes: a halo that is wider than the ball itself just
          fogs the face and turns a 36px avatar into a pink smudge. */}
      {px >= 60 && (
        <motion.div
          aria-hidden="true"
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            background:
              'radial-gradient(circle at 50% 55%, rgba(168,85,247,0.42), rgba(236,72,153,0.18) 55%, transparent 72%)',
            filter: `blur(${Math.max(3, px * 0.09)}px)`,
            transform: 'scale(1.16)',
          }}
          animate={reduced ? {} : { opacity: isThinking ? [0.45, 0.85, 0.45] : [0.4, 0.62, 0.4] }}
          transition={
            reduced ? { duration: 0 } : { duration: isThinking ? 1.4 : 3.6, repeat: Infinity, ease: 'easeInOut' }
          }
        />
      )}

      <svg
        viewBox="0 0 100 100"
        width={px}
        height={px}
        className="relative block"
        role="img"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          {/* Body: bright rose highlight top-left → saturated magenta → violet
              core, so the sphere has a clear colour story instead of a mush. */}
          <radialGradient id={id('body')} cx="34%" cy="25%" r="88%">
            <stop offset="0%" stopColor="#FFF2FB" />
            <stop offset="13%" stopColor="#FFB0E4" />
            <stop offset="31%" stopColor="#F062C8" />
            <stop offset="50%" stopColor="#C026D3" />
            <stop offset="70%" stopColor="#8B5CF6" />
            <stop offset="87%" stopColor="#6D28D9" />
            <stop offset="100%" stopColor="#4C1D95" />
          </radialGradient>

          {/* Warm counter-light from the lower left — the reference orb's amber
              corner, which is what stops it reading as a flat purple ball. */}
          <radialGradient id={id('warm')} cx="24%" cy="80%" r="60%">
            <stop offset="0%" stopColor="#FFC46B" stopOpacity="0.95" />
            <stop offset="42%" stopColor="#FB7185" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#FB7185" stopOpacity="0" />
          </radialGradient>

          {/* Bottom shade: gives the sphere weight. Kept light so it does not
              swallow the warm corner. */}
          <radialGradient id={id('shade')} cx="66%" cy="94%" r="58%">
            <stop offset="0%" stopColor="#2E1065" stopOpacity="0.42" />
            <stop offset="70%" stopColor="#2E1065" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#2E1065" stopOpacity="0" />
          </radialGradient>

          {/* Specular sheen. */}
          <radialGradient id={id('sheen')} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>

          <linearGradient id={id('rim')} x1="15%" y1="0%" x2="85%" y2="100%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.85" />
            <stop offset="45%" stopColor="#FFFFFF" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.45" />
          </linearGradient>

          <clipPath id={id('clip')}>
            <circle cx="50" cy="50" r="46" />
          </clipPath>
        </defs>

        <g clipPath={`url(#${id('clip')})`}>
          <circle cx="50" cy="50" r="46" fill={`url(#${id('body')})`} />
          <circle cx="50" cy="50" r="46" fill={`url(#${id('warm')})`} />
          <circle cx="50" cy="50" r="46" fill={`url(#${id('shade')})`} />

          {/* A slow orbiting highlight while it is thinking. */}
          {isThinking && !reduced && (
            <motion.circle
              cx="50"
              cy="16"
              r="11"
              fill={`url(#${id('sheen')})`}
              animate={{ rotate: 360 }}
              transition={{ duration: 2.6, repeat: Infinity, ease: 'linear' }}
              style={{ transformOrigin: '50px 50px' }}
            />
          )}

          {/* Specular highlight, top-left. */}
          <ellipse cx="33" cy="28" rx="17" ry="12" fill={`url(#${id('sheen')})`} opacity="0.75" />

          {/* Eyes. Rounded, angled slightly inward — the "friendly" cue. */}
          <g>
            {[-1, 1].map((side) => (
              <motion.rect
                key={side}
                x={50 + side * (eyeW * 0.92) - eyeW / 2}
                y={isThinking ? 45 : isSuccess ? 47 : 48}
                width={eyeW}
                height={eyeH}
                rx={eyeW / 2}
                fill="#FFFFFF"
                style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                animate={{
                  // Blink: squash to a line. Thinking: eyes lift and narrow.
                  scaleY: blink ? 0.12 : isThinking ? 0.86 : 1,
                  scaleX: blink ? 1.08 : 1,
                  rotate: side === -1 ? -9 : 9,
                }}
                transition={{ duration: blink ? 0.12 : 0.35, ease: 'easeInOut' }}
              />
            ))}
          </g>

          {/* Rim light last, so it sits above the shading. */}
          <circle
            cx="50"
            cy="50"
            r="45.4"
            fill="none"
            stroke={`url(#${id('rim')})`}
            strokeWidth="1.3"
            opacity="0.9"
          />
        </g>
      </svg>

      {/* Ground shadow: a soft contact ellipse so the orb sits in the layout. */}
      <div
        aria-hidden="true"
        className="absolute left-1/2 -translate-x-1/2 rounded-[50%] pointer-events-none"
        style={{
          bottom: -px * 0.1,
          width: px * 0.62,
          height: Math.max(3, px * 0.09),
          background: 'radial-gradient(ellipse at center, rgba(124,58,237,0.28), transparent 70%)',
          filter: `blur(${Math.max(2, px * 0.045)}px)`,
        }}
      />

      {/* A small star burst on success. */}
      <AnimatePresence>
        {isSuccess && !reduced && (
          <motion.span
            key="spark"
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            className="absolute -right-0.5 -top-0.5 select-none"
            style={{ color: '#a855f7' }}
            aria-hidden="true"
          >
            <Sparkles size={Math.max(10, px * 0.24)} strokeWidth={2.5} />
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function NoboMascot({
  state = 'idle',
  message,
  size = 'md',
  className = '',
  label,
}: NoboMascotProps) {
  const px = SIZE_PX[size];

  return (
    <div
      className={`flex items-center gap-3 select-none ${className}`}
      role="img"
      aria-label={label || (message ? `${STATE_LABEL[state]}: ${message}` : STATE_LABEL[state])}
    >
      <NoboOrb size={size} state={state} />

      <AnimatePresence mode="wait">
        {message && (
          <motion.div
            key={message}
            initial={{ scale: 0.92, x: -6 }}
            animate={{ scale: 1, x: 0 }}
            exit={{ scale: 0.92, x: -4 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="relative px-3.5 py-2 max-w-xs"
            style={{
              // Tokenised: the orb speaks in both themes, and this bubble used to be a
              // hardcoded white box with a hardcoded near-black label.
              background: 'var(--nobo-card)',
              border: '1px solid var(--nobo-bubble-user-border, rgba(124,58,237,0.14))',
              borderRadius: 16,
              borderBottomLeftRadius: 6,
              boxShadow: 'var(--nobo-card-shadow)',
              color: 'var(--dsw-alias-label-primary)',
              fontSize: Math.max(12, Math.min(15, px * 0.2)),
              lineHeight: 1.35,
              fontWeight: 500,
            }}
            aria-live="polite"
          >
            {message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
