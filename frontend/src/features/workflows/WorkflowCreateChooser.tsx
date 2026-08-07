/**
 * WorkflowCreateChooser — the fork at /workflows/new.
 *
 * Both routes produce the same artifact: a WorkflowDefinition that compiles to
 * a Mistral Workflows SDK module. They differ only in how the DAG is authored,
 * and either can be reopened in the visual builder afterwards.
 */

import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Cpu,
  GitBranch,
  MousePointerSquareDashed,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { cn } from '../../lib/utils';

interface ModeCardProps {
  icon: React.ReactNode;
  title: string;
  tagline: string;
  bullets: string[];
  cta: string;
  accent: string;
  glow: string;
  onClick: () => void;
  delay: number;
}

function ModeCard({
  icon,
  title,
  tagline,
  bullets,
  cta,
  accent,
  glow,
  onClick,
  delay,
}: ModeCardProps) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.35 }}
      className="group relative flex flex-col text-left rounded-2xl border border-[var(--color-border-subtle)] bg-[rgba(15,20,28,0.7)] backdrop-blur-md p-6 transition-all duration-300 hover:-translate-y-1"
      style={{ boxShadow: '0 10px 30px rgba(0,0,0,0.4)' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = accent;
        e.currentTarget.style.boxShadow = `0 0 30px rgba(${glow},0.18), 0 14px 34px rgba(0,0,0,0.55)`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = '';
        e.currentTarget.style.boxShadow = '0 10px 30px rgba(0,0,0,0.4)';
      }}
    >
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center mb-5 shrink-0"
        style={{ background: accent }}
      >
        {icon}
      </div>

      <h2 className="text-lg font-bold text-white mb-1.5">{title}</h2>
      <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed mb-5">
        {tagline}
      </p>

      <ul className="space-y-2 mb-6 flex-1">
        {bullets.map((bullet) => (
          <li key={bullet} className="flex items-start gap-2">
            <span
              className="w-1 h-1 rounded-full mt-[7px] shrink-0"
              style={{ background: accent }}
            />
            <span className="text-xs text-[var(--color-text-muted)] leading-relaxed">{bullet}</span>
          </li>
        ))}
      </ul>

      <span
        className="inline-flex items-center gap-2 text-sm font-semibold transition-transform group-hover:translate-x-0.5"
        style={{ color: accent }}
      >
        {cta}
        <ArrowRight size={15} />
      </span>
    </motion.button>
  );
}

export default function WorkflowCreateChooser() {
  const navigate = useNavigate();

  return (
    <div className="h-full overflow-y-auto custom-scrollbar bg-[rgba(8,11,19,0.95)]">
      <div className="max-w-4xl mx-auto px-6 py-16">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mx-auto mb-6 shadow-[0_0_40px_rgba(99,102,241,0.3)]">
            <GitBranch size={30} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight mb-3">
            How do you want to build it?
          </h1>
          <p className="text-[var(--color-text-muted)] max-w-xl mx-auto leading-relaxed">
            Both paths produce the same thing — a workflow DAG that compiles to a Mistral Workflows
            module you can publish and run. You can switch to the visual editor at any point.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 gap-5">
          <ModeCard
            delay={0.05}
            icon={<Sparkles size={24} className="text-white" />}
            title="Describe it"
            tagline="State the goal and let the planner assemble the pipeline for you."
            accent="#818cf8"
            glow="129,140,248"
            cta="Start from a description"
            bullets={[
              'Works out which agents and tools the goal needs',
              'Synthesises any tool that does not exist yet',
              'Reuses existing agents instead of duplicating them',
              'Best when you know the outcome but not the steps',
            ]}
            onClick={() => navigate('/workflows/new/ai')}
          />

          <ModeCard
            delay={0.12}
            icon={<MousePointerSquareDashed size={24} className="text-white" />}
            title="Build it visually"
            tagline="Drag agents onto a canvas, wire them together, and attach the tools each one may call."
            accent="#22d3ee"
            glow="34,211,238"
            cta="Open the builder"
            bullets={[
              'Full control over ordering, branching and parallel groups',
              'Create agents and synthesise tools without leaving the canvas',
              'Live validation before anything is saved',
              'Best when you already know the exact shape you want',
            ]}
            onClick={() => navigate('/workflows/new/visual')}
          />
        </div>

        {/* What both paths give you */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="mt-10 rounded-xl border border-[var(--color-border-subtle)] bg-[rgba(255,255,255,0.02)] px-5 py-4"
        >
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-3">
            Either way you get
          </p>
          <div className="grid sm:grid-cols-3 gap-4">
            {[
              { icon: <Cpu size={13} />, label: 'Agents wired into a DAG', hint: 'sequential, branching or parallel' },
              { icon: <Wrench size={13} />, label: 'Tools attached to agents', hint: 'the agent decides when to call them' },
              { icon: <GitBranch size={13} />, label: 'A publishable module', hint: 'compiled and registered on Mistral' },
            ].map((item) => (
              <div key={item.label} className="flex items-start gap-2.5">
                <span className="w-6 h-6 rounded-md bg-[rgba(99,102,241,0.12)] border border-[rgba(99,102,241,0.25)] flex items-center justify-center text-[#a5b4fc] shrink-0">
                  {item.icon}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-[var(--color-text-secondary)] leading-snug">
                    {item.label}
                  </p>
                  <p className="text-[10px] text-[var(--color-text-muted)] leading-snug mt-0.5">
                    {item.hint}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        <div className="text-center mt-8">
          <button
            type="button"
            onClick={() => navigate('/workflows')}
            className={cn(
              'text-xs text-[var(--color-text-muted)] hover:text-white transition-colors',
            )}
          >
            Back to workflows
          </button>
        </div>
      </div>
    </div>
  );
}
