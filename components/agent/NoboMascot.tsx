'use client';

import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import { Sparkles, Bot, Zap, CheckCircle2 } from 'lucide-react';

interface NoboMascotProps {
  state?: 'idle' | 'thinking' | 'success' | 'talking';
  message?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export default function NoboMascot({
  state = 'idle',
  message,
  size = 'md',
  className = '',
}: NoboMascotProps) {
  const sizePixels = size === 'sm' ? 44 : size === 'md' ? 72 : 110;

  return (
    <div className={`flex items-center gap-3 relative select-none ${className}`}>
      {/* Animated Glowing Aura */}
      <motion.div
        animate={{
          scale: state === 'thinking' ? [1, 1.25, 1] : [1, 1.1, 1],
          opacity: state === 'thinking' ? [0.4, 0.8, 0.4] : [0.25, 0.5, 0.25],
        }}
        transition={{
          repeat: Infinity,
          duration: state === 'thinking' ? 1.4 : 3,
          ease: 'easeInOut',
        }}
        className="absolute inset-0 -m-2 rounded-full bg-gradient-to-tr from-violet-500/30 via-blue-500/30 to-indigo-500/20 blur-xl pointer-events-none"
      />

      {/* Nobo 3D Mascot Character */}
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
        {/* Orbiting Halo Ring when thinking */}
        {state === 'thinking' && (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 2.5, ease: 'linear' }}
            className="absolute -inset-1.5 rounded-full border-2 border-dashed border-violet-400/80 pointer-events-none"
          />
        )}

        {/* Mascot Avatar Frame */}
        <div
          style={{ width: sizePixels, height: sizePixels }}
          className="rounded-2xl overflow-hidden shadow-lg shadow-blue-500/15 border-2 border-white/80 dark:border-slate-800 bg-gradient-to-b from-blue-50 to-indigo-100 dark:from-slate-800 dark:to-slate-900 flex items-center justify-center relative"
        >
          <img
            src={state === 'thinking' ? '/nobo-character.jpg' : '/nobo-mascot.jpg'}
            alt="Nobo Mascot"
            className="w-full h-full object-cover object-center scale-105 transition-all duration-300"
          />

          {/* Status Badge Pip */}
          <div className="absolute bottom-1 right-1">
            {state === 'thinking' ? (
              <span className="flex h-3 w-3 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500 border border-white"></span>
              </span>
            ) : state === 'success' ? (
              <span className="h-3 w-3 rounded-full bg-emerald-500 border border-white flex items-center justify-center">
                <CheckCircle2 size={10} className="text-white" />
              </span>
            ) : (
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 border border-white"></span>
            )}
          </div>
        </div>
      </motion.div>

      {/* Nobo Speech / Thinking Bubble */}
      <AnimatePresence mode="wait">
        {message && (
          <motion.div
            key={message}
            initial={{ opacity: 0, scale: 0.9, x: -6 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.9, x: -4 }}
            className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md px-3.5 py-2 rounded-2xl rounded-bl-sm border border-slate-200/80 dark:border-slate-800 shadow-md text-xs text-slate-800 dark:text-slate-200 flex items-center gap-2 max-w-xs"
          >
            {state === 'thinking' ? (
              <Zap size={14} className="text-blue-500 shrink-0 animate-bounce" />
            ) : (
              <Sparkles size={14} className="text-violet-500 shrink-0" />
            )}
            <span className="font-medium leading-tight">{message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
