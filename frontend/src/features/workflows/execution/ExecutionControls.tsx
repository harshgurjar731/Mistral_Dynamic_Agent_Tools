import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Ban, ChevronDown, Loader2, OctagonX, Radio, Rewind, Search, Send, Zap,
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import { executionsApi, isActive } from '../../../api/executions';

/**
 * The control surface for a single execution: cancel, terminate, reset, and the
 * three invocation channels (signal / query / update).
 *
 * Destructive actions ask for confirmation inline rather than through a modal —
 * the panel is narrow and a dialog here would cover the very timeline you are
 * deciding against.
 */

type Channel = 'signals' | 'queries' | 'updates';

const CHANNELS: Record<Channel, { label: string; hint: string; icon: typeof Send }> = {
  signals: {
    label: 'Signal',
    hint: 'Fire-and-forget message into a running workflow handler.',
    icon: Send,
  },
  queries: {
    label: 'Query',
    hint: 'Read state out of the workflow. Does not mutate anything.',
    icon: Search,
  },
  updates: {
    label: 'Update',
    hint: 'Like a signal, but waits for the handler to return a value.',
    icon: Zap,
  },
};

function parseInput(raw: string): Record<string, unknown> {
  const text = raw.trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { value: parsed };
  } catch {
    // Plain text is the common case for a chat-style signal, so it is wrapped
    // rather than rejected.
    return { message: text };
  }
}

export default function ExecutionControls({
  executionId,
  status,
  source,
  onActed,
}: {
  executionId: string;
  status: string;
  source: 'mistral' | 'local';
  onActed?: (message: string) => void;
}) {
  const [confirming, setConfirming] = useState<'cancel' | 'terminate' | null>(null);
  const [channel, setChannel] = useState<Channel>('signals');
  const [name, setName] = useState('user_message');
  const [payload, setPayload] = useState('');
  const [response, setResponse] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [resetEventId, setResetEventId] = useState('');

  const live = isActive(status);

  const stopMut = useMutation({
    mutationFn: async (mode: 'cancel' | 'terminate') =>
      mode === 'cancel'
        ? executionsApi.cancel(executionId)
        : executionsApi.terminate(executionId),
    onSuccess: (res, mode) => {
      setConfirming(null);
      const data: any = res.data;
      if (data?.accepted === false) {
        onActed?.(data.detail ?? 'The execution had already finished.');
        return;
      }
      onActed?.(
        mode === 'cancel'
          ? 'Cancellation requested — the workflow stops after its current step.'
          : 'Termination requested.',
      );
    },
    onError: (error: any) => {
      setConfirming(null);
      onActed?.(error?.response?.data?.detail ?? 'The stop request failed.');
    },
  });

  const invokeMut = useMutation({
    mutationFn: async () => {
      const input = parseInput(payload);
      if (channel === 'signals') return executionsApi.signal(executionId, name, input);
      if (channel === 'queries') return executionsApi.query(executionId, name, input);
      return executionsApi.update(executionId, name, input);
    },
    onSuccess: (res) => {
      const data: any = res.data;
      if (channel === 'signals') {
        setResponse(
          data?.delivered
            ? `Signal '${name}' delivered.`
            : `Not delivered: ${data?.detail ?? 'the workflow may have no handler for this signal.'}`,
        );
      } else {
        setResponse(
          data?.result == null
            ? 'Handler returned no value.'
            : typeof data.result === 'string'
              ? data.result
              : JSON.stringify(data.result, null, 2),
        );
      }
      if (channel !== 'queries') setPayload('');
    },
    onError: (error: any) => {
      setResponse(error?.response?.data?.detail ?? 'The request failed.');
    },
  });

  const resetMut = useMutation({
    mutationFn: async () =>
      executionsApi.reset(executionId, {
        event_id: Number(resetEventId),
        reason: 'Reset from the execution console',
      }),
    onSuccess: () => {
      setResetEventId('');
      onActed?.('Reset requested — the execution replays from that event.');
    },
    onError: (error: any) => {
      onActed?.(error?.response?.data?.detail ?? 'Reset failed.');
    },
  });

  const ChannelIcon = CHANNELS[channel].icon;

  return (
    <div className="space-y-4">
      {/* ── Stop controls ─────────────────────────────────────────────── */}
      <div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
          Lifecycle
        </p>
        {live ? (
          <div className="flex gap-2">
            {(['cancel', 'terminate'] as const).map((mode) => {
              const Icon = mode === 'cancel' ? Ban : OctagonX;
              const pending = stopMut.isPending && stopMut.variables === mode;
              const armed = confirming === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  disabled={stopMut.isPending}
                  onClick={() => (armed ? stopMut.mutate(mode) : setConfirming(mode))}
                  onBlur={() => armed && setConfirming(null)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-semibold transition-colors disabled:opacity-50',
                    armed
                      ? 'border-red-500/50 bg-red-500/20 text-red-200'
                      : mode === 'cancel'
                        ? 'border-[var(--color-border-subtle)] bg-white/[0.03] text-[var(--color-text-secondary)] hover:border-amber-400/40 hover:text-amber-300'
                        : 'border-[var(--color-border-subtle)] bg-white/[0.03] text-[var(--color-text-secondary)] hover:border-red-400/40 hover:text-red-300',
                  )}
                >
                  {pending ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}
                  {armed ? 'Confirm?' : mode === 'cancel' ? 'Cancel' : 'Terminate'}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="rounded-lg border border-[var(--color-border-subtle)] bg-white/[0.02] px-3 py-2 text-[11px] text-[var(--color-text-muted)]">
            This execution has finished — nothing left to stop.
          </p>
        )}
        <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--color-text-muted)] opacity-70">
          Cancel lets cleanup handlers run; terminate stops it where it stands.
          {source === 'local' && ' Local runs stop at the next step boundary.'}
        </p>
      </div>

      {/* ── Invocation channels ───────────────────────────────────────── */}
      <div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
          Interact
        </p>

        <div className="mb-2 flex gap-1 rounded-lg border border-[var(--color-border-subtle)] bg-black/20 p-1">
          {(Object.keys(CHANNELS) as Channel[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => { setChannel(key); setResponse(null); }}
              className={cn(
                'flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                channel === key
                  ? 'bg-indigo-500/20 text-indigo-200'
                  : 'text-[var(--color-text-muted)] hover:text-white',
              )}
            >
              {CHANNELS[key].label}
            </button>
          ))}
        </div>

        <p className="mb-2 text-[10px] leading-relaxed text-[var(--color-text-muted)] opacity-70">
          {CHANNELS[channel].hint}
        </p>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="handler name"
          className="mb-2 w-full rounded-lg border border-[var(--color-border-subtle)] bg-black/30 px-3 py-2 font-mono text-[11px] text-white placeholder:text-[var(--color-text-muted)] focus:border-indigo-500/50 focus:outline-none"
        />
        <textarea
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          rows={2}
          placeholder='payload — JSON object, or plain text'
          className="mb-2 w-full resize-none rounded-lg border border-[var(--color-border-subtle)] bg-black/30 px-3 py-2 font-mono text-[11px] text-white placeholder:text-[var(--color-text-muted)] focus:border-indigo-500/50 focus:outline-none custom-scrollbar"
        />
        <button
          type="button"
          onClick={() => invokeMut.mutate()}
          disabled={!name.trim() || invokeMut.isPending}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-500/20 px-3 py-2 text-[11px] font-semibold text-indigo-200 transition-colors hover:bg-indigo-500/30 disabled:opacity-40"
        >
          {invokeMut.isPending ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <ChannelIcon size={12} />
          )}
          Send {CHANNELS[channel].label.toLowerCase()}
        </button>

        {response && (
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--color-border-subtle)] bg-black/40 px-3 py-2 font-mono text-[10px] text-[var(--color-text-secondary)] custom-scrollbar">
            {response}
          </pre>
        )}
      </div>

      {/* ── Reset ─────────────────────────────────────────────────────── */}
      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex w-full items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] hover:text-white"
        >
          <ChevronDown
            size={11}
            className={cn('transition-transform', showAdvanced && 'rotate-180')}
          />
          Replay
        </button>

        {showAdvanced && (
          <div className="mt-2 space-y-2">
            <p className="text-[10px] leading-relaxed text-[var(--color-text-muted)] opacity-70">
              Rewind to a history event and replay from there. Find the event id in
              the History tab.
            </p>
            <div className="flex gap-2">
              <input
                value={resetEventId}
                onChange={(e) => setResetEventId(e.target.value.replace(/\D/g, ''))}
                placeholder="event id"
                inputMode="numeric"
                className="min-w-0 flex-1 rounded-lg border border-[var(--color-border-subtle)] bg-black/30 px-3 py-2 font-mono text-[11px] text-white placeholder:text-[var(--color-text-muted)] focus:border-indigo-500/50 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => resetMut.mutate()}
                disabled={!resetEventId || resetMut.isPending || source === 'local'}
                title={source === 'local' ? 'Reset is only available for executions on Mistral' : undefined}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-[11px] font-semibold text-[var(--color-text-secondary)] transition-colors hover:border-indigo-400/40 hover:text-indigo-300 disabled:opacity-40"
              >
                {resetMut.isPending ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Rewind size={12} />
                )}
                Reset
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="flex items-center gap-1.5 border-t border-[var(--color-border-subtle)] pt-3 text-[10px] text-[var(--color-text-muted)] opacity-60">
        <Radio size={9} />
        {source === 'mistral' ? 'Running on Mistral' : 'Running in the local DAG engine'}
      </p>
    </div>
  );
}
