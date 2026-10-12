/**
 * "Miss" tab of the drawer. Shows miss-level fields, a reason-code correction
 * control, and one of three lifecycle panels depending on status:
 *
 *   open            → the single corrective-action assign form (the operator's
 *                     manual equivalent of the agent's bulk assign)
 *   action assigned → the assigned action + a Resolve close-out control
 *   resolved        → the assigned action + who closed it, when, and the note
 */
import { useEffect, useState } from 'react';
import { CheckCircle2, ClipboardCheck } from 'lucide-react';
import {
  assignCorrectiveActionSingle,
  resolveMiss,
  updateMissReason,
} from '@/lib/returns';
import { useReasonCodes } from '@/lib/useReasonCodes';
import type { MissDetail, ReasonCode } from '@/shared/types';

export function MissTab({
  detail,
  onMutated,
}: {
  detail: MissDetail;
  onMutated: () => void;
}) {
  const { codes } = useReasonCodes();
  const [reason, setReason] = useState<ReasonCode>(detail.reasonCode ?? '');
  const [savingReason, setSavingReason] = useState(false);
  const [actionDesc, setActionDesc] = useState(detail.correctiveActionDesc ?? '');
  const [owner, setOwner] = useState(detail.correctiveActionOwner ?? '');
  const [implDate, setImplDate] = useState(
    detail.correctiveActionImplDate ?? '',
  );
  const [assigning, setAssigning] = useState(false);
  const [closeNote, setCloseNote] = useState('');
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReason(detail.reasonCode ?? '');
    setActionDesc(detail.correctiveActionDesc ?? '');
    setOwner(detail.correctiveActionOwner ?? '');
    setImplDate(detail.correctiveActionImplDate ?? '');
    setCloseNote('');
    setError(null);
  }, [detail.id]);

  async function saveReason(next: ReasonCode) {
    setReason(next);
    setSavingReason(true);
    setError(null);
    try {
      await updateMissReason(detail.id, next);
      onMutated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingReason(false);
    }
  }

  async function assign() {
    if (!actionDesc || !owner || !implDate) {
      setError('Action, owner, and target date are required.');
      return;
    }
    setAssigning(true);
    setError(null);
    try {
      await assignCorrectiveActionSingle(detail.id, {
        actionDesc,
        owner,
        implementationDate: implDate,
        caStatus: 'planned',
      });
      onMutated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAssigning(false);
    }
  }

  async function resolve() {
    setResolving(true);
    setError(null);
    try {
      await resolveMiss(detail.id, closeNote.trim() || undefined);
      onMutated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setResolving(false);
    }
  }

  const isOpen = detail.status === 'open';
  const isAssigned = detail.status === 'action assigned';

  // The catalog only returns ACTIVE codes. If this miss carries one that was
  // since retired, keep it in the list so the select doesn't silently blank
  // out (and so saving an unrelated field can't drop the code).
  const options =
    reason && !codes.some((c) => c.code === reason)
      ? [reason, ...codes.map((c) => c.code)]
      : codes.map((c) => c.code);

  return (
    <div className="space-y-6 max-w-2xl">
      <dl className="grid grid-cols-2 sm:grid-cols-1 gap-x-4 gap-y-3 sm:gap-y-4 text-sm">
        <DetailRow label="Comment" value={detail.comment ?? '—'} full />
        <DetailRow
          label="Miss units"
          value={
            detail.missUnits !== null ? detail.missUnits.toLocaleString() : '—'
          }
        />
        <DetailRow label="Miss date" value={detail.missDate ?? '—'} />
        <DetailRow label="Plant" value={`${detail.plantName ?? '—'}`} />
        <DetailRow label="Region" value={detail.region ?? '—'} />
        <DetailRow label="SKU" value={detail.skuName ?? '—'} />
        <DetailRow
          label="Production line"
          value={
            detail.lineName
              ? `${detail.lineName}${detail.lineId ? ` · ${detail.lineId}` : ''}`
              : '—'
          }
        />
        <DetailRow
          label="Production order"
          value={
            <span className="font-mono">{detail.productionOrder ?? '—'}</span>
          }
        />
      </dl>

      <div className="space-y-2">
        <label className="block text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          Reason code
        </label>
        <select
          value={reason}
          disabled={savingReason}
          onChange={(e) => void saveReason(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40 disabled:opacity-50"
        >
          <option value="" disabled>
            Select reason…
          </option>
          {options.map((rc) => (
            <option key={rc} value={rc}>
              {rc}
            </option>
          ))}
        </select>
      </div>

      {isOpen ? (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            Assign corrective action
          </div>
          <textarea
            value={actionDesc}
            onChange={(e) => setActionDesc(e.target.value)}
            placeholder="Corrective action (e.g. replace worn bearing on Line 3, schedule PM)…"
            rows={3}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="Owner"
              className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
            />
            <input
              type="date"
              value={implDate}
              onChange={(e) => setImplDate(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
            />
          </div>
          {error && <div className="text-xs text-destructive">{error}</div>}
          <button
            onClick={assign}
            disabled={assigning}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <ClipboardCheck className="size-4" />
            {assigning ? 'Assigning…' : 'Assign action'}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm space-y-1">
            <div className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              Corrective action
            </div>
            <div>{detail.correctiveActionDesc ?? '—'}</div>
            <div className="text-xs text-muted-foreground">
              {detail.correctiveActionOwner ?? '—'} ·{' '}
              {detail.correctiveActionImplDate ?? '—'} ·{' '}
              {detail.correctiveActionStatus ?? '—'}
            </div>
          </div>

          {isAssigned ? (
            <div className="space-y-3 rounded-xl border border-border bg-card p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                Resolve this action
              </div>
              <textarea
                value={closeNote}
                onChange={(e) => setCloseNote(e.target.value)}
                placeholder="Close note (optional) — e.g. bearing replaced 8/14, line back to standard rate."
                rows={2}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
              />
              <button
                onClick={() => void resolve()}
                disabled={resolving}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                <CheckCircle2 className="size-4" />
                {resolving ? 'Resolving…' : 'Resolve'}
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-[var(--success-subtle)] bg-[var(--success-subtle)] p-4 text-sm space-y-1">
              <div className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--success-subtle-foreground)]">
                Resolved
              </div>
              <div className="text-[var(--success-subtle-foreground)]">
                {detail.resolutionNote ?? 'Corrective action closed out'}
              </div>
              <div className="text-xs text-[var(--success-subtle-foreground)] opacity-80">
                {detail.resolvedBy ?? '—'}
                {detail.resolvedAt
                  ? ` · ${new Date(detail.resolvedAt).toLocaleString()}`
                  : ''}
              </div>
            </div>
          )}

          {error && <div className="text-xs text-destructive">{error}</div>}
        </div>
      )}
    </div>
  );
}

function DetailRow({
  label,
  value,
  full,
}: {
  label: string;
  value: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div
      className={`flex flex-col sm:grid sm:grid-cols-3 ${
        full ? 'col-span-2 sm:col-span-1' : ''
      }`}
    >
      <dt className="text-xs uppercase tracking-[0.15em] text-muted-foreground pt-0.5">
        {label}
      </dt>
      <dd className="sm:col-span-2">{value}</dd>
    </div>
  );
}
