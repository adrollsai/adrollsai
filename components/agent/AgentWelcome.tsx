'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Rocket, Clapperboard, Users, ArrowRight } from 'lucide-react';
import { NoboOrb } from './NoboMascot';

/**
 * The first thing an owner sees in the agent, before any conversation exists.
 *
 * It replaces a small bot glyph and two text links with the same idea done
 * properly: the mascot greets you, says in one sentence what this thing is for,
 * and offers four ways to start. Every card sends a real prompt through the same
 * `handleSend` the composer uses, so nothing here is decorative — there is no
 * second code path to keep working.
 */

interface Suggestion {
  title: string;
  hint: string;
  prompt: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  tint: string;
}

const SUGGESTIONS: Suggestion[] = [
  {
    title: "Today's work",
    hint: 'One creative, plus the follow-ups that are due',
    prompt: "Run today's marketing: make one strong creative for the business and send whatever follow-ups are due.",
    icon: Sparkles,
    tint: '#7c3aed',
  },
  {
    title: 'Festival video',
    hint: '15s vertical greeting for your clients',
    prompt:
      'Make a 15-second 9:16 video wishing our clients Happy Diwali on behalf of the business, and deliver it to me.',
    icon: Clapperboard,
    tint: '#ec4899',
  },
  {
    title: 'Launch a campaign',
    hint: 'Lead-gen campaign, quoted before any spend',
    prompt:
      'Inspect the active Meta campaigns, then prepare a high-intent lead generation campaign for Instagram Reels at ₹1,500/day. Quote me before spending anything.',
    icon: Rocket,
    tint: '#f59e0b',
  },
  {
    title: 'Chase the leads',
    hint: 'Follow up with everyone who went quiet',
    prompt: 'Follow up with every lead that has not replied in the last three days, and tell me who needs me.',
    icon: Users,
    tint: '#0ea5e9',
  },
];

export default function AgentWelcome({
  onPrompt,
  onGetStarted,
  disabled = false,
}: {
  onPrompt: (text: string) => void;
  onGetStarted: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="nobo-welcome py-10 sm:py-14 flex flex-col items-center text-center font-sans">
      {/* Mascot + greeting bubble */}
      <div className="relative flex items-start justify-center">
        <NoboOrb size="xl" state="idle" />
        <motion.div
          initial={{ y: 6, scale: 0.9 }}
          animate={{ y: 0, scale: 1 }}
          transition={{ delay: 0.25, duration: 0.4, ease: 'easeOut' }}
          className="hidden xs:block absolute -right-2 top-1 sm:top-3 px-3.5 py-2"
          style={{
            background: '#ffffff',
            border: '1px solid rgba(124,58,237,0.14)',
            borderRadius: 16,
            borderBottomLeftRadius: 6,
            boxShadow: '0 8px 22px rgba(76,29,149,0.12)',
            color: '#191634',
            fontSize: 13,
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          Hello!
        </motion.div>
      </div>

      <motion.h1
        initial={{ y: 8 }}
        animate={{ y: 0 }}
        transition={{ delay: 0.08, duration: 0.35 }}
        className="mt-6 text-[26px] sm:text-[32px] font-bold tracking-tight"
        style={{ color: 'var(--dsw-alias-label-primary)', letterSpacing: '-0.02em' }}
      >
        Any tasks?
      </motion.h1>

      <motion.p
        initial={{ y: 8 }}
        animate={{ y: 0 }}
        transition={{ delay: 0.14, duration: 0.35 }}
        className="mt-2 max-w-md text-[14px] sm:text-[15px] leading-relaxed"
        style={{ color: 'var(--dsw-alias-label-tertiary)' }}
      >
        I&apos;m Nobo, your marketing department. Ask for a creative, a video, a campaign — or just tell me what
        needs doing today. I&apos;ll quote before I spend anything.
      </motion.p>

      <motion.button
        type="button"
        onClick={onGetStarted}
        initial={{ y: 8 }}
        animate={{ y: 0 }}
        transition={{ delay: 0.2, duration: 0.35 }}
        className="mt-6 inline-flex items-center gap-2 px-6 py-3 text-[14px] font-semibold"
        style={{
          borderRadius: 999,
          background: 'linear-gradient(135deg, #8b5cf6 0%, #a855f7 45%, #ec4899 100%)',
          color: '#ffffff',
          boxShadow: '0 10px 24px rgba(139,92,246,0.34)',
        }}
      >
        Get started
        <ArrowRight size={16} />
      </motion.button>

      {/* Ways in. Each one sends a real prompt. */}
      <div className="mt-9 grid w-full max-w-lg grid-cols-1 sm:grid-cols-2 gap-2.5 text-left">
        {SUGGESTIONS.map((s, i) => {
          const Icon = s.icon;
          return (
            <motion.button
              key={s.title}
              type="button"
              disabled={disabled}
              onClick={() => onPrompt(s.prompt)}
              initial={{ y: 10 }}
              animate={{ y: 0 }}
              transition={{ delay: 0.24 + i * 0.05, duration: 0.3 }}
              className="nobo-suggestion group flex items-start gap-3 p-3.5 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: '#ffffff',
                border: '1px solid var(--dsw-alias-border-l1)',
                borderRadius: 16,
                boxShadow: '0 2px 10px rgba(76,29,149,0.05)',
              }}
            >
              <span
                className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                style={{ background: `${s.tint}14`, color: s.tint }}
              >
                <Icon size={17} />
              </span>
              <span className="min-w-0">
                <span
                  className="block text-[13px] font-semibold truncate"
                  style={{ color: 'var(--dsw-alias-label-primary)' }}
                >
                  {s.title}
                </span>
                <span
                  className="mt-0.5 block text-[11.5px] leading-snug"
                  style={{ color: 'var(--dsw-alias-label-tertiary)' }}
                >
                  {s.hint}
                </span>
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
