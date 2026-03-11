import type { AudienceAgentState, DeliveryAgentState } from '../types';

function deliveryToneClasses(mode: DeliveryAgentState['agentMode']): string {
  if (mode === 'rescue') return 'border-red-500/45 bg-red-950/78 text-red-100';
  if (mode === 'directive') return 'border-amber-500/40 bg-amber-950/78 text-amber-50';
  if (mode === 'soft_cue') return 'border-sky-500/35 bg-sky-950/75 text-sky-50';
  return 'border-zinc-700/40 bg-zinc-950/72 text-zinc-100';
}

function audienceToneClasses(priority: AudienceAgentState['priority'], captureStatus: AudienceAgentState['captureStatus']): string {
  if (captureStatus === 'lost') return 'border-red-500/45 bg-red-950/78 text-red-100';
  if (priority === 'critical') return 'border-orange-500/40 bg-orange-950/76 text-orange-50';
  if (priority === 'watch') return 'border-emerald-500/35 bg-emerald-950/76 text-emerald-50';
  return 'border-zinc-700/40 bg-zinc-950/72 text-zinc-100';
}

function audienceLabel(status: AudienceAgentState['captureStatus']): string {
  if (status === 'active') return 'Audience';
  if (status === 'requesting') return 'Connecting audience';
  if (status === 'lost') return 'Audience lost';
  if (status === 'denied') return 'Audience skipped';
  if (status === 'unsupported') return 'Audience unavailable';
  return 'Audience';
}

function engagementBadge(engagement: AudienceAgentState['engagement']): string {
  if (engagement === 'high') return 'Engaged';
  if (engagement === 'moderate') return 'Moderate';
  if (engagement === 'low') return 'Low engagement';
  return '';
}

export function DualAgentOverlay({
  delivery,
  audience,
  variant,
}: {
  delivery: DeliveryAgentState;
  audience: AudienceAgentState;
  variant: 'rehearsal' | 'presentation';
}) {
  const hasDeliveryContent = Boolean(delivery.microPrompt || delivery.rescueText || delivery.feedbackMessage);
  const hasAudienceContent = Boolean(
    audience.audiencePrompt
      || audience.audienceDetails
      || audience.captureStatus === 'requesting'
      || audience.captureStatus === 'lost',
  );

  if (!hasDeliveryContent && !hasAudienceContent) return null;

  return (
    <div className={`absolute inset-0 pointer-events-none p-4 flex ${variant === 'presentation' ? 'justify-start items-start' : 'justify-center items-start'}`}>
      <div className="flex w-full max-w-4xl gap-3">
        {hasDeliveryContent && (
          <section className={`pointer-events-none min-w-0 flex-1 rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-xl ${deliveryToneClasses(delivery.agentMode)}`}>
            <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.18em] text-white/50">
              <span>Delivery agent</span>
              <span className="capitalize">{delivery.agentMode}</span>
            </div>
            {delivery.microPrompt && (
              <p className="mt-2 text-lg font-semibold leading-tight">{delivery.microPrompt}</p>
            )}
            {(delivery.rescueText || delivery.feedbackMessage) && (
              <p className="mt-2 text-sm leading-relaxed text-white/78">
                {delivery.rescueText || delivery.feedbackMessage}
              </p>
            )}
          </section>
        )}

        {hasAudienceContent && (
          <section className={`pointer-events-none min-w-0 flex-1 rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-xl ${audienceToneClasses(audience.priority, audience.captureStatus)}`}>
            <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.18em] text-white/50">
              <span>{audienceLabel(audience.captureStatus)}</span>
              <span>
                {audience.handsRaised != null && audience.handsRaised > 0
                  ? `${audience.handsRaised} hand${audience.handsRaised > 1 ? 's' : ''} raised`
                  : engagementBadge(audience.engagement) || 'Watching'}
              </span>
            </div>
            {audience.audiencePrompt && (
              <p className="mt-2 text-lg font-semibold leading-tight">{audience.audiencePrompt}</p>
            )}
            {audience.audienceDetails && (
              <p className="mt-2 text-sm leading-relaxed text-white/78">{audience.audienceDetails}</p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
