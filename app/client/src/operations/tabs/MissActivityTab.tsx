/**
 * Audit-trail timeline for one miss (ai_audit_trail[]). Sorted newest-first.
 * Records the agent's + operators' actions: action_assigned, action_resolved,
 * reason_updated, note.
 */
import { useMemo } from 'react';
import { CheckCircle2, ClipboardCheck, PencilLine, StickyNote } from 'lucide-react';
import type { AuditEntry, MissDetail } from '@/shared/types';

export function MissActivityTab({ detail }: { detail: MissDetail }) {
  const items = useMemo(
    () =>
      [...(detail.aiAuditTrail ?? [])].sort((a, b) =>
        (b.at ?? '').localeCompare(a.at ?? ''),
      ),
    [detail],
  );

  if (items.length === 0) {
    return (
      <div className="text-sm text-muted-foreground max-w-md">
        Nothing's happened on this miss yet. Once the assistant (or an operator)
        assigns a corrective action or corrects the reason code, it will show up
        here.
      </div>
    );
  }

  return (
    <ol className="space-y-3 max-w-3xl">
      {items.map((audit, i) => (
        <li key={i}>
          <AuditRow audit={audit} />
        </li>
      ))}
    </ol>
  );
}

function AuditRow({ audit }: { audit: AuditEntry }) {
  const { icon, tone, label } = describe(audit.action);
  return (
    <div className="rounded-md border border-border bg-card px-4 py-2.5 flex items-start gap-3">
      <div
        className={`size-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${tone}`}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm">
          <span className="font-medium">{label}</span>
          {audit.notes && (
            <span className="text-muted-foreground"> · {audit.notes}</span>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {audit.by}
          {audit.tool && ` · via ${audit.tool}`}
        </div>
      </div>
      <div className="text-xs text-muted-foreground shrink-0">
        {fmt(audit.at)}
      </div>
    </div>
  );
}

function describe(action: AuditEntry['action']) {
  switch (action) {
    case 'action_assigned':
      return {
        icon: <ClipboardCheck className="size-3.5" />,
        tone: 'bg-[var(--info-subtle)] text-[var(--info-subtle-foreground)]',
        label: 'Corrective action assigned',
      };
    case 'action_resolved':
      return {
        icon: <CheckCircle2 className="size-3.5" />,
        tone: 'bg-[var(--success-subtle)] text-[var(--success-subtle-foreground)]',
        label: 'Corrective action resolved',
      };
    case 'reason_updated':
      return {
        icon: <PencilLine className="size-3.5" />,
        tone: 'bg-[var(--warning-subtle)] text-[var(--warning-subtle-foreground)]',
        label: 'Reason code updated',
      };
    default:
      return {
        icon: <StickyNote className="size-3.5" />,
        tone: 'bg-muted text-muted-foreground',
        label: 'Note',
      };
  }
}

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
