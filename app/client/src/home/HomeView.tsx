/**
 * Home / landing page.
 *
 * Tells the STORY of the use case. The narrative pieces (hero persona,
 * headline, situation, goal, journey diagram quotes, starter prompts,
 * featured action) are hardcoded here. Only `assistantScript` and `branding`
 * stay config-driven (the script chain is reused by the chat dock; branding
 * is also read by the shell header).
 */
import { Fragment, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  ClipboardCheck,
  Eye,
  MessageCircleQuestion,
  PencilLine,
  Sparkles,
  StickyNote,
  Wrench,
  Zap,
} from 'lucide-react';
import { useSession, type ScriptStep } from '@/lib/api';
import { fetchActivity } from '@/lib/returns';
import type { ActivityEvent } from '@/shared/types';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import { AgentLoopFlow } from '@/architecture/AgentLoopFlow';

// ---------------------------------------------------------------------------
// Narrative — Plant Attainment Control Tower.
// ---------------------------------------------------------------------------

const HERO = {
  name: 'Maya Patel',
  role: 'VP of Manufacturing Excellence',
};

const STORY = {
  headline: "Attainment dropped two weeks ago — and the backlog is piling up.",
  situation:
    "Company attainment slipped from ~96% to ~94% about two weeks ago, driven by three plants — Plano (PLNT-07), Tulsa (PLNT-12), and Fresno (PLNT-15) — that fell to ~82%. Mechanical Downtime and Material Shortage dominate the open-miss backlog, and nothing has a corrective action assigned yet.",
  goal: 'Find the root cause, size the backlog by plant and reason, and get corrective actions assigned to every open miss.',
};

const STARTER_QUESTIONS = [
  'Why did attainment drop about two weeks ago?',
  'Which plants and reason codes are driving the misses?',
  'What does the Plano open-miss backlog look like?',
];

const FEATURED_ACTION_PROMPT =
  "Attainment dropped two weeks ago and Plano (PLNT-07) is one of the worst. Look at the Plano open-miss backlog and show me how many are open by reason code. Then draft one corrective action per reason code — with an owner and a target date — and show me before assigning. Once I approve, assign these corrective actions to every open miss at Plano.";

export function HomeView() {
  const { config, configError, retry: retrySession } = useSession();
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    const reload = () =>
      fetchActivity(20)
        .then(setActivity)
        .catch((e) => {
          console.error('[home] activity feed failed', e);
        });
    void reload();
    return dataMutated.subscribe(reload);
  }, []);

  if (configError) {
    return (
      <div className="p-12 max-w-xl text-sm">
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-destructive flex items-start gap-3">
          <AlertTriangle className="size-5 mt-0.5 shrink-0" />
          <div className="space-y-2">
            <div className="font-semibold">Couldn't load app config</div>
            <div className="text-destructive/80">{configError}</div>
            <button
              type="button"
              onClick={retrySession}
              className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1 text-xs hover:bg-destructive/15 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!config) {
    return <div className="p-12 text-muted-foreground">Loading…</div>;
  }

  const heroFirstName = HERO.name.split(/\s+/)[0];

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 sm:px-8 py-6 sm:py-14 space-y-5 sm:space-y-7">
        {/* Hero */}
        <section className="space-y-5">
          <div className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            <span className="inline-block h-px w-8 bg-foreground/40" />
            {HERO.name} · {HERO.role}
          </div>
          <h1 className="display text-3xl sm:text-5xl lg:text-6xl font-semibold leading-[1.05] tracking-tight text-foreground">
            {STORY.headline}
          </h1>
          <p className="hidden sm:block text-lg text-muted-foreground leading-relaxed max-w-3xl">
            {STORY.situation}
          </p>
          <p
            className="inline-block text-sm text-foreground italic border-l-2 pl-3 py-0.5 max-w-3xl"
            style={{ borderColor: 'var(--accent)' }}
          >
            <span className="font-semibold not-italic uppercase tracking-[0.15em] text-xs text-muted-foreground mr-2">
              Goal
            </span>
            {STORY.goal}
          </p>
        </section>

        {/* Persona journey diagram */}
        <section className="space-y-5">
          <div className="hidden sm:block text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            A morning in the control tower
          </div>
          <JourneyDiagram heroName={heroFirstName} script={config.assistantScript} />

          <AgentLoopFlow />
        </section>

        {/* Starter prompts — each opens the floating assistant dock */}
        <section className="space-y-3">
          <div className="hidden sm:block text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Try asking
          </div>
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
            {STARTER_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => dockController.newAndSend(q)}
                className="flex w-full sm:w-auto sm:inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm text-foreground hover:border-foreground/30 hover:shadow-sm transition-all"
              >
                <Sparkles className="size-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1 text-left sm:flex-none">{q}</span>
                <ArrowRight className="size-3.5 text-muted-foreground shrink-0" />
              </button>
            ))}
          </div>
        </section>

        {/* Featured action — climax. */}
        <section>
          <div
            className="rounded-2xl p-7 relative overflow-hidden"
            style={{
              background:
                'linear-gradient(135deg, color-mix(in oklch, var(--primary) 96%, white) 0%, color-mix(in oklch, var(--primary) 88%, var(--accent) 12%) 100%)',
              color: 'var(--primary-foreground)',
            }}
          >
            <div
              className="absolute -right-16 -top-16 size-52 rounded-full opacity-20"
              style={{ background: 'var(--accent)' }}
            />
            <div className="relative">
              <div className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] opacity-80 mb-3">
                <Zap className="size-3.5" />
                Let the assistant handle it
              </div>
              <h3 className="display text-2xl font-semibold mb-2 leading-tight">
                Clear the Plano backlog — one corrective action per reason code
              </h3>
              <p className="hidden sm:block text-sm opacity-85 leading-relaxed mb-5 max-w-2xl">
                The assistant traces the drop to Plano/Tulsa/Fresno, sizes the
                Plano open-miss backlog by reason code, and drafts a corrective
                action per reason — owner and target date included. It waits for
                your approval, then assigns the actions to every open miss at
                Plano in one atomic write. Watch the queue flip and the map
                bubble shrink.
              </p>
              <p className="sm:hidden text-sm opacity-85 leading-relaxed mb-5">
                Size the Plano backlog, draft actions per reason code, approve —
                then assign to every open miss at once.
              </p>
              <button
                onClick={() => dockController.newAndSend(FEATURED_ACTION_PROMPT)}
                className="inline-flex items-center gap-2 rounded-full bg-background text-foreground px-5 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
              >
                Run this <ArrowRight className="size-4" />
              </button>
            </div>
          </div>
        </section>

        {/* Proof — activity feed */}
        {activity.length > 0 && (
          <section className="space-y-4">
            <div className="hidden sm:block text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Recent activity
            </div>
            <ActivityFeed
              events={activity}
              onJumpToMiss={(id) => navigate(`/operations?miss=${id}`)}
            />
          </section>
        )}
      </div>
    </div>
  );
}

// --- Journey diagram -------------------------------------------------------

function JourneyDiagram({
  heroName,
  script,
}: {
  heroName: string;
  script: ScriptStep[];
}) {
  const navigate = useNavigate();
  const step0 = script[0];
  const step2 = script[2];
  const step3 = script[3];

  const steps = [
    {
      icon: <Eye className="size-5" />,
      role: `${heroName} operates`,
      quote: '"Attainment dipped — three plants lit up red."',
      highlight: false,
      onClick: () => navigate('/operations'),
    },
    {
      icon: <MessageCircleQuestion className="size-5" />,
      role: 'She asks',
      quote: '"Why did attainment drop two weeks ago?"',
      highlight: false,
      onClick: () =>
        step0
          ? dockController.newAndSend(step0.prompt)
          : dockController.open(),
    },
    {
      icon: <Brain className="size-5" />,
      role: 'AI investigates',
      quote: '"Plano, Tulsa, Fresno — Mechanical Downtime and Material Shortage."',
      highlight: true,
      onClick: () => dockController.open(),
    },
    {
      icon: <Wrench className="size-5" />,
      role: 'AI takes action',
      quote: '"Drafted a corrective action per reason. Assigned the whole backlog."',
      highlight: true,
      onClick: () => {
        if (step2) dockController.openAndSend(step2.prompt);
        else if (step3) dockController.openAndSend(step3.prompt);
        else dockController.open();
      },
    },
  ];

  return (
    <>
      <div className="hidden md:grid grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] gap-3 items-stretch">
        {steps.map((s, i) => (
          <Fragment key={i}>
            <button
              onClick={s.onClick}
              className={`text-left rounded-xl px-4 py-4 flex flex-col gap-2 transition-all hover:shadow-sm ${stepCardClass(s.highlight)}`}
              style={stepCardStyle(s.highlight)}
            >
              <StepIcon step={s} size="sm" />
              <StepText step={s} />
            </button>
            {i < steps.length - 1 && (
              <div className="flex items-center justify-center text-muted-foreground">
                <ArrowRight className="size-4" />
              </div>
            )}
          </Fragment>
        ))}
      </div>

      <ol className="md:hidden relative flex flex-col gap-2.5">
        <div
          aria-hidden
          className="absolute left-[18px] top-7 bottom-7 w-px bg-border"
        />
        {steps.map((s, i) => (
          <li key={i} className="relative flex items-start gap-3">
            <StepIcon step={s} size="md" className="relative z-10 shrink-0 mt-1" />
            <button
              onClick={s.onClick}
              className={`flex-1 min-w-0 text-left rounded-xl px-3 py-2.5 transition-all hover:shadow-sm ${stepCardClass(s.highlight)}`}
              style={stepCardStyle(s.highlight)}
            >
              <StepText step={s} compact />
            </button>
          </li>
        ))}
      </ol>
    </>
  );
}

type JourneyStep = {
  icon: React.ReactNode;
  role: string;
  quote: string;
  highlight: boolean;
  onClick: () => void;
};

function stepCardClass(highlight: boolean): string {
  return highlight
    ? 'border-2 bg-card'
    : 'border border-border bg-card hover:border-foreground/30';
}

function stepCardStyle(highlight: boolean): React.CSSProperties | undefined {
  return highlight ? { borderColor: 'var(--accent)' } : undefined;
}

function StepIcon({
  step,
  size,
  className = '',
}: {
  step: JourneyStep;
  size: 'sm' | 'md';
  className?: string;
}) {
  const sizeClass = size === 'sm' ? 'size-8' : 'size-9';
  return (
    <div
      className={`${sizeClass} rounded-lg flex items-center justify-center ${className}`}
      style={{
        background: step.highlight ? 'var(--accent)' : 'var(--muted)',
        color: step.highlight ? 'var(--accent-foreground)' : 'var(--foreground)',
      }}
    >
      {step.icon}
    </div>
  );
}

function StepText({ step, compact = false }: { step: JourneyStep; compact?: boolean }) {
  return (
    <>
      <div
        className={`text-sm font-semibold text-foreground ${compact ? 'leading-tight' : ''}`}
      >
        {step.role}
      </div>
      <div
        className={`text-xs text-muted-foreground leading-snug italic ${compact ? 'mt-0.5' : ''}`}
      >
        {step.quote}
      </div>
    </>
  );
}

// --- Activity feed ---------------------------------------------------------

function ActivityFeed({
  events,
  onJumpToMiss,
}: {
  events: ActivityEvent[];
  onJumpToMiss: (missId: string) => void;
}) {
  return (
    <ul className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
      {events.map((e, i) => (
        <li key={i} className="px-4 py-3 flex items-start gap-3 text-sm">
          <ActivityIcon action={e.action} />
          <div className="flex-1 min-w-0">
            <div className="text-foreground">
              <span className="font-medium">{labelFor(e.action)}</span>
              {e.notes && (
                <span className="text-muted-foreground"> · {e.notes}</span>
              )}
              <span className="text-xs text-muted-foreground ml-2">
                by {e.by}
                {e.tool ? ` · via ${e.tool}` : ''}
              </span>
            </div>
            <button
              onClick={() => onJumpToMiss(e.miss_id)}
              className="mt-0.5 text-xs text-muted-foreground hover:text-foreground"
            >
              View miss →
            </button>
          </div>
          <div className="text-xs text-muted-foreground shrink-0">
            {relativeTime(e.at)}
          </div>
        </li>
      ))}
    </ul>
  );
}

function labelFor(action: string): string {
  if (action === 'action_assigned') return 'Corrective action assigned';
  if (action === 'reason_updated') return 'Reason code updated';
  return 'Note';
}

function ActivityIcon({ action }: { action: string }) {
  const { Icon, bg } =
    action === 'action_assigned'
      ? {
          Icon: ClipboardCheck,
          bg: 'bg-[var(--info-subtle)] text-[var(--info-subtle-foreground)]',
        }
      : action === 'reason_updated'
        ? {
            Icon: PencilLine,
            bg: 'bg-[var(--warning-subtle)] text-[var(--warning-subtle-foreground)]',
          }
        : { Icon: StickyNote, bg: 'bg-muted text-muted-foreground' };
  return (
    <div
      className={`size-7 rounded-full flex items-center justify-center shrink-0 ${bg}`}
    >
      <Icon className="size-3.5" />
    </div>
  );
}

function relativeTime(iso: string): string {
  const d = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.max(1, Math.round((now - d) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}
