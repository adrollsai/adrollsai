'use client';

import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Zap, CheckCircle2 } from 'lucide-react';

interface NoboMascotProps {
  state?: 'idle' | 'thinking' | 'success' | 'talking';
  message?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * Mascot + speech bubble.
 *
 * Decorative, but still on the token system: the previous version keyed its
 * colours off Tailwind `dark:` variants, which never fire under the harness
 * (it sets `data-theme`, and tailwind.config.ts leaves darkMode at the default
 * 'media'), so the bubble rendered light-on-dark for anyone whose OS was in
 * light mode.
 */
export default function NoboMascot({
  state = 'idle',
  message,
  size = 'md',
  className = '',
}: NoboMascotProps) {
  const sizePixels = size === 'sm' ? 44 : size === 'md' ? 72 : 110;

  return (
    <div className={`flex items-center gap-3 relative select-none ${className}`}>
      {/* Soft aura — one accent tint, not a three-colour gradient */}
      <motion.div
        animate={{
          scale: state === 'thinking' ? [1, 1.25, 1] : [1, 1.1, 1],
          opacity: state === 'thinking' ? [0.35, 0.7, 0.35] : [0.2, 0.4, 0.2],
        }}
        transition={{
          repeat: Infinity,
          duration: state === 'thinking' ? 1.4 : 3,
          ease: 'easeInOut',
        }}
        className="absolute inset-0 -m-2 rounded-full blur-xl pointer-events-none"
        style={{ background: 'var(--dsw-alias-state-business-primary)' }}
      />

      <motion.div
        animate={
          state === 'thinking'
            ? {
                y: [0, -8, 0],
                rotate: [-2, 2, -2],
                transition: { repeat: Infinity, duration: 1.2, ease: 'easeInOut' },
              }
            : state === 'success'
            ? {
                scale: [1, 1.18, 1],
                y: [0, -12, 0],
                transition: { duration: 0.6, ease: 'easeOut' },
              }
            : {
                y: [0, -4, 0],
                transition: { repeat: Infinity, duration: 3.5, ease: 'easeInOut' },
              }
        }
        whileHover={{ scale: 1.1, rotate: 4 }}
        whileTap={{ scale: 0.95 }}
        className="relative cursor-pointer shrink-0"
      >
        {state === 'thinking' && (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 2.5, ease: 'linear' }}
            className="absolute -inset-1.5 rounded-full border-2 border-dashed pointer-events-none"
            style={{ borderColor: 'var(--dsw-alias-state-business-primary)' }}
          />
        )}

        <div
          style={{
            width: sizePixels,
            height: sizePixels,
            background: 'var(--dsw-alias-bg-layer-2)',
            border: '1px solid var(--dsw-alias-border-l2)',
            boxShadow: 'var(--dsw-shadow-lv2)',
            borderRadius: 'var(--dsh-radius-lg)',
          }}
          className="overflow-hidden flex items-center justify-center relative"
        >
          <img
            src={state === 'thinking' ? '/nobo-character.jpg' : '/nobo-mascot.jpg'}
            alt="Nobo Mascot"
            className="w-full h-full object-cover object-center scale-105 transition-all duration-300"
          />

          <div className="absolute bottom-1 right-1">
            {state === 'thinking' ? (
              <span className="flex h-3 w-3 relative">
                <span
                  className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                  style={{ background: 'var(--dsw-alias-state-business-primary)' }}
                />
                <span
                  className="relative inline-flex rounded-full h-3 w-3"
                  style={{
                    background: 'var(--dsw-alias-state-business-primary)',
                    border: '1px solid var(--dsw-alias-bg-layer-2)',
                  }}
                />
              </span>
            ) : state === 'success' ? (
              <span
                className="h-3 w-3 rounded-full flex items-center justify-center"
                style={{
                  background: 'var(--dsw-alias-state-success-primary)',
                  border: '1px solid var(--dsw-alias-bg-layer-2)',
                }}
              >
                <CheckCircle2 size={10} style={{ color: 'var(--dsw-alias-bg-layer-2)' }} />
              </span>
            ) : (
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{
                  background: 'var(--dsw-alias-state-success-primary)',
                  border: '1px solid var(--dsw-alias-bg-layer-2)',
                }}
              />
            )}
          </div>
        </div>
      </motion.div>

      <AnimatePresence mode="wait">
        {message && (
          <motion.div
            key={message}
            initial={{ opacity: 0, scale: 0.9, x: -6 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.9, x: -4 }}
            className="px-3.5 py-2 flex items-center gap-2 max-w-xs"
            style={{
              background: 'var(--dsw-alias-bg-layer-2)',
              border: '1px solid var(--dsw-alias-border-l1)',
              borderRadius: 'var(--dsh-radius-lg)',
              boxShadow: 'var(--dsw-shadow-lv2)',
              color: 'var(--dsw-alias-label-primary)',
              fontSize: 'var(--dsh-text-s)',
              lineHeight: '22px',
            }}
          >
            {state === 'thinking' ? (
              <Zap size={14} className="dsh-accent shrink-0 animate-bounce" />
            ) : (
              <Sparkles size={14} className="dsh-accent shrink-0" />
            )}
            <span className="dsh-strong leading-tight">{message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
