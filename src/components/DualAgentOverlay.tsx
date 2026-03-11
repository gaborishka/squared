import type { DeliveryAgentState, ScreenAgentState } from '../types';

function deliveryToneClasses(mode: DeliveryAgentState['agentMode']): string {
  if (mode === 'rescue') return 'border-red-500/45 bg-red-950/78 text-red-100';
  if (mode === 'directive') return 'border-amber-500/40 bg-amber-950/78 text-amber-50';
  if (mode === 'soft_cue') return 'border-sky-500/35 bg-sky-950/75 text-sky-50';
  return 'border-zinc-700/40 bg-zinc-950/72 text-zinc-100';
}

function screenToneClasses(priority: ScreenAgentState['screenPriority'], captureStatus: ScreenAgentState['captureStatus']): string {
  if (captureStatus === 'lost') return 'border-red-500/45 bg-red-950/78 text-red-100';
  if (priority === 'critical') return 'border-orange-500/40 bg-orange-950/76 text-orange-50';
  if (priority === 'watch') return 'border-emerald-500/35 bg-emerald-950/76 text-emerald-50';
  return 'border-zinc-700/40 bg-zinc-950/72 text-zinc-100';
}

function captureLabel(status: ScreenAgentState['captureStatus']): string {
  if (status === 'active') return 'Screen';
  if (status === 'requesting') return 'Connecting screen';
  if (status === 'lost') return 'Screen lost';
  if (status === 'denied') return 'Screen skipped';
  if (status === 'unsupported') return 'Screen unavailable';
  return 'Screen';
}

export function DualAgentOverlay({
  delivery,
  screen,
  variant,
}: {
  delivery: DeliveryAgentState;
  screen: ScreenAgentState;
  variant: 'rehearsal' | 'presentation';
}) {
  const hasDeliveryContent = Boolean(delivery.microPrompt || delivery.rescueText || delivery.feedbackMessage);
  const hasScreenContent = Boolean(
    screen.screenPrompt
      || screen.screenDetails
      || screen.captureStatus === 'requesting'
      || screen.captureStatus === 'lost',
  );

  if (!hasDeliveryContent && !hasScreenContent) return null;

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

        {hasScreenContent && (
          <section className={`pointer-events-none min-w-0 flex-1 rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-xl ${screenToneClasses(screen.screenPriority, screen.captureStatus)}`}>
            <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.18em] text-white/50">
              <span>{captureLabel(screen.captureStatus)}</span>
              <span>
                {screen.currentSlide != null ? `Slide ${screen.currentSlide}` : screen.sourceLabel || 'Navigation'}
              </span>
            </div>
            {screen.screenPrompt && (
              <p className="mt-2 text-lg font-semibold leading-tight">{screen.screenPrompt}</p>
            )}
            {screen.screenDetails && (
              <p className="mt-2 text-sm leading-relaxed text-white/78">{screen.screenDetails}</p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
