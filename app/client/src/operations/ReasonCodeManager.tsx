/**
 * Reason-code catalog manager — the slide-over behind "Manage codes" on the
 * Operations queue.
 *
 * This is the in-app replacement for maintaining the reason-code list by hand
 * in the weekly Excel export: add a code, rename one (which cascades to every
 * miss carrying it), or retire one. Everything persists to Lakebase.
 *
 * Retire is deliberately a soft delete — the "N in use" count next to each row
 * is there so nobody retires a code thinking it will scrub history.
 */
import { useState } from 'react';
import { Check, Pencil, Plus, RotateCcw, X } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@databricks/appkit-ui/react';
import {
  createReasonCode,
  retireReasonCode,
  updateReasonCode,
} from '@/lib/returns';
import { useReasonCodes } from '@/lib/useReasonCodes';
import { dataMutated } from '@/lib/events';
import type { ReasonCodeRow } from '@/shared/types';

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40 disabled:opacity-50';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ReasonCodeManager({ open, onOpenChange }: Props) {
  // Include retired codes so they can be restored from the same list.
  const { codes, loading, reload } = useReasonCodes(true);
  const [newCode, setNewCode] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draftCode, setDraftCode] = useState('');
  const [draftDesc, setDraftDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Every mutation refreshes the catalog AND the queue — a rename rewrites
   *  the misses, so the table behind the sheet would otherwise go stale. */
  async function mutate(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
      dataMutated.emit();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const code = newCode.trim();
    if (!code) {
      setError('Enter a code name.');
      return;
    }
    const ok = await mutate(() =>
      createReasonCode({
        code,
        description: newDesc.trim() || undefined,
        // Land new codes after the seeded ones rather than interleaved.
        sortOrder: 200,
      }),
    );
    if (ok) {
      setNewCode('');
      setNewDesc('');
    }
  }

  function startEdit(rc: ReasonCodeRow) {
    setEditing(rc.code);
    setDraftCode(rc.code);
    setDraftDesc(rc.description ?? '');
    setError(null);
  }

  async function saveEdit(original: string) {
    const code = draftCode.trim();
    if (!code) {
      setError('Code name cannot be empty.');
      return;
    }
    const ok = await mutate(() =>
      updateReasonCode(original, {
        newCode: code === original ? undefined : code,
        description: draftDesc.trim(),
      }),
    );
    if (ok) setEditing(null);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="!w-full sm:!w-[60vw] sm:!max-w-[60vw] lg:!w-[560px] lg:!max-w-[560px] p-0 flex flex-col"
      >
        <SheetHeader className="px-8 pt-8 pb-4 border-b border-border">
          <SheetTitle className="display text-2xl">Reason codes</SheetTitle>
          <SheetDescription>
            The miss-code list plant users pick from. Stored in Lakebase, not
            the weekly spreadsheet. Renaming a code updates every miss that
            carries it; retiring one hides it from new entries but leaves
            history untouched.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
          <div className="space-y-2 rounded-xl border border-border bg-card p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              Add a code
            </div>
            <input
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              placeholder="Code name — e.g. Seal Integrity Fail"
              className={inputClass}
            />
            <input
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Description (optional)"
              className={inputClass}
            />
            <button
              onClick={() => void add()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              <Plus className="size-4" />
              Add code
            </button>
          </div>

          {error && <div className="text-xs text-destructive">{error}</div>}

          {loading && codes.length === 0 && (
            <div className="text-sm text-muted-foreground">Loading…</div>
          )}

          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {codes.map((rc) => (
              <li key={rc.code} className="px-4 py-3">
                {editing === rc.code ? (
                  <div className="space-y-2">
                    <input
                      value={draftCode}
                      onChange={(e) => setDraftCode(e.target.value)}
                      className={inputClass}
                    />
                    <input
                      value={draftDesc}
                      onChange={(e) => setDraftDesc(e.target.value)}
                      placeholder="Description (optional)"
                      className={inputClass}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => void saveEdit(rc.code)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-50"
                      >
                        <Check className="size-3.5" />
                        Save
                      </button>
                      <button
                        onClick={() => setEditing(null)}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <X className="size-3.5" />
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`text-sm font-medium ${
                            rc.active ? '' : 'text-muted-foreground line-through'
                          }`}
                        >
                          {rc.code}
                        </span>
                        {!rc.active && (
                          <span className="text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 bg-muted text-muted-foreground">
                            retired
                          </span>
                        )}
                        {rc.usageCount > 0 && (
                          <span className="text-[11px] text-muted-foreground tabular-nums">
                            {rc.usageCount.toLocaleString()} in use
                          </span>
                        )}
                      </div>
                      {rc.description && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {rc.description}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => startEdit(rc)}
                        title="Rename or edit description"
                        className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      {rc.active ? (
                        <button
                          onClick={() =>
                            void mutate(() => retireReasonCode(rc.code))
                          }
                          disabled={busy}
                          title="Retire this code"
                          className="rounded-md p-1.5 text-muted-foreground hover:text-destructive hover:bg-muted disabled:opacity-50"
                        >
                          <X className="size-3.5" />
                        </button>
                      ) : (
                        <button
                          onClick={() =>
                            void mutate(() =>
                              updateReasonCode(rc.code, { active: true }),
                            )
                          }
                          disabled={busy}
                          title="Restore this code"
                          className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50"
                        >
                          <RotateCcw className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  );
}
