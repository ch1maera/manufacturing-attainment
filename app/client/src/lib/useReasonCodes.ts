/**
 * The reason-code catalog, shared by the drawer's reason select and the
 * ReasonCodeManager sheet. Refetches on `dataMutated` so a code added in the
 * manager shows up in an already-open drawer (and a rename, which cascades to
 * the misses, lands in both places at once).
 */
import { useCallback, useEffect, useState } from 'react';
import { fetchReasonCodes } from './returns';
import { dataMutated } from './events';
import type { ReasonCodeRow } from '@/shared/types';

export function useReasonCodes(includeInactive = false) {
  const [codes, setCodes] = useState<ReasonCodeRow[]>([]);
  // Only tracks the FIRST load. Later refetches swap the list in place —
  // the catalog is small enough that flashing a spinner on every edit is
  // more distracting than useful.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      fetchReasonCodes(includeInactive)
        .then((rows) => {
          setCodes(rows);
          setError(null);
        })
        .catch((e) => setError((e as Error).message))
        .finally(() => setLoading(false)),
    [includeInactive],
  );

  useEffect(() => {
    void reload();
    return dataMutated.subscribe(() => {
      void reload();
    });
  }, [reload]);

  return { codes, loading, error, reload };
}
