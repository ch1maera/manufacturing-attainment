/**
 * Right-side drawer with two tabs (Miss / Activity). Opens when the user
 * clicks a row in the miss table. Auto-refreshes on dataMutated (so when the
 * assistant assigns a corrective action, this view reflects it live).
 */
import { useEffect, useState } from 'react';
import { Activity, Factory } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@databricks/appkit-ui/react';
import { fetchMiss } from '@/lib/returns';
import { dataMutated } from '@/lib/events';
import { StatusBadge, ReasonBadge } from '@/shared/badges';
import type { MissDetail } from '@/shared/types';

import { MissTab } from './tabs/MissTab';
import { MissActivityTab } from './tabs/MissActivityTab';

type Props = {
  id: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMutated: () => void;
};

export function MissDrawer({ id, open, onOpenChange, onMutated }: Props) {
  const [detail, setDetail] = useState<MissDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setDetail(null);
      return;
    }
    setLoading(true);
    fetchMiss(id)
      .then(setDetail)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
    const unsub = dataMutated.subscribe(() => {
      if (id) void fetchMiss(id).then(setDetail).catch(() => {});
    });
    return unsub;
  }, [id]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="!w-full sm:!w-[60vw] sm:!max-w-[60vw] lg:!w-[640px] lg:!max-w-[640px] p-0 flex flex-col"
      >
        {!detail && loading && (
          <div className="p-8 text-muted-foreground">Loading…</div>
        )}
        {error && <div className="p-8 text-destructive">{error}</div>}
        {detail && (
          <>
            <SheetHeader className="px-8 pt-8 pb-4 border-b border-border">
              <div className="flex items-center gap-3 flex-wrap">
                <StatusBadge status={detail.status} />
                <ReasonBadge reason={detail.reasonCode} />
                <span className="font-mono text-xs text-muted-foreground inline-flex items-center gap-1">
                  <Factory className="size-3" /> {detail.plantId ?? '—'}
                </span>
              </div>
              <SheetTitle className="display text-2xl">
                {detail.skuName ?? 'Miss'}
              </SheetTitle>
              <SheetDescription className="flex items-center gap-2 flex-wrap">
                <span>{detail.plantName ?? '—'}</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">
                  {detail.region ?? ''}
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground font-mono">
                  {detail.id}
                </span>
              </SheetDescription>
            </SheetHeader>
            <Tabs defaultValue="miss" className="flex-1 flex flex-col min-h-0">
              <TabsList className="mx-8 mt-4 w-fit">
                <TabsTrigger value="miss">Miss</TabsTrigger>
                <TabsTrigger value="activity">
                  <Activity className="size-3.5 mr-1" />
                  Activity{' '}
                  {detail.aiAuditTrail.length > 0 &&
                    `(${detail.aiAuditTrail.length})`}
                </TabsTrigger>
              </TabsList>
              <TabsContent
                value="miss"
                className="flex-1 overflow-y-auto px-8 py-6"
              >
                <MissTab detail={detail} onMutated={onMutated} />
              </TabsContent>
              <TabsContent
                value="activity"
                className="flex-1 overflow-y-auto px-8 py-6"
              >
                <MissActivityTab detail={detail} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
