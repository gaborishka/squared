import { useEffect, useRef, MutableRefObject } from 'react';

const BAR_COUNT = 5;
const BIN_INDICES = [1, 3, 5, 8, 12]; // voice frequency range
const IDLE_SCALE = 0.12;
const MAX_SCALE = 1;
const TARGET_FPS = 30;
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;
const ATTACK = 0.35;
const RELEASE = 0.18;
const NOISE_FLOOR_ADAPT = 0.02;
const GATE_OFFSET = 0.025;
const SILENCE_MARGIN = 0.008;
const SILENCE_HOLD_FRAMES = 8;

export function AudioWaveform({
    volumeLevel,
    analyserRef,
}: {
    volumeLevel: string;
    analyserRef?: MutableRefObject<AnalyserNode | null>;
}) {
    const barsContainerRef = useRef<HTMLDivElement>(null);
    const rafRef = useRef<number>(0);
    const dataArrayRef = useRef<Uint8Array | null>(null);
    const levelsRef = useRef<number[]>(Array(BAR_COUNT).fill(0));
    const noiseFloorRef = useRef(0.015);
    const silenceFramesRef = useRef(0);

    // Animate bars via direct DOM — zero React re-renders
    useEffect(() => {
        const container = barsContainerRef.current;
        if (!container) return;
        const barEls = Array.from(container.children) as HTMLElement[];

        let lastFrameTime = 0;

        const tick = (timestamp: number) => {
            if (timestamp - lastFrameTime < FRAME_INTERVAL_MS) {
                rafRef.current = requestAnimationFrame(tick);
                return;
            }
            lastFrameTime = timestamp;

            const analyser = analyserRef?.current;
            if (!analyser) {
                silenceFramesRef.current = SILENCE_HOLD_FRAMES + 1;
                for (let i = 0; i < BAR_COUNT; i++) {
                    levelsRef.current[i] *= 0.7;
                    const scale = IDLE_SCALE + levelsRef.current[i] * (MAX_SCALE - IDLE_SCALE);
                    barEls[i].style.transform = `scaleY(${scale.toFixed(3)})`;
                }
                rafRef.current = requestAnimationFrame(tick);
                return;
            }

            const requiredLength = analyser.frequencyBinCount;
            if (!dataArrayRef.current || dataArrayRef.current.length !== requiredLength) {
                dataArrayRef.current = new Uint8Array(requiredLength);
            }
            const dataArray = dataArrayRef.current;
            analyser.getByteFrequencyData(dataArray);

            let frameEnergy = 0;
            for (let i = 0; i < BAR_COUNT; i++) {
                const bin = Math.min(BIN_INDICES[i], dataArray.length - 1);
                frameEnergy += (dataArray[bin] ?? 0) / 255;
            }
            frameEnergy /= BAR_COUNT;

            const floorTarget = Math.min(frameEnergy, 0.08);
            noiseFloorRef.current = (noiseFloorRef.current * (1 - NOISE_FLOOR_ADAPT)) + (floorTarget * NOISE_FLOOR_ADAPT);
            const gate = Math.min(0.25, noiseFloorRef.current + GATE_OFFSET);

            if (frameEnergy < gate + SILENCE_MARGIN) {
                silenceFramesRef.current += 1;
            } else {
                silenceFramesRef.current = 0;
            }

            const lockToIdle = silenceFramesRef.current > SILENCE_HOLD_FRAMES;

            for (let i = 0; i < BAR_COUNT; i++) {
                const bin = Math.min(BIN_INDICES[i], dataArray.length - 1);
                const raw = (dataArray[bin] ?? 0) / 255;
                const cleaned = lockToIdle ? 0 : Math.max(0, (raw - gate) / Math.max(0.001, 1 - gate));
                const curved = Math.pow(cleaned, 0.75);
                const prev = levelsRef.current[i];
                const smoothing = curved > prev ? ATTACK : RELEASE;
                const next = prev + (curved - prev) * smoothing;

                levelsRef.current[i] = next;
                const scale = IDLE_SCALE + next * (MAX_SCALE - IDLE_SCALE);
                barEls[i].style.transform = `scaleY(${Math.max(IDLE_SCALE, scale).toFixed(3)})`;
            }

            rafRef.current = requestAnimationFrame(tick);
        };

        rafRef.current = requestAnimationFrame(tick);

        return () => cancelAnimationFrame(rafRef.current);
    }, [analyserRef]);

    let barColor = 'bg-indigo-500';
    if (volumeLevel === 'Too Quiet') barColor = 'bg-amber-500';
    if (volumeLevel === 'Too Loud') barColor = 'bg-red-500';

    return (
        <div ref={barsContainerRef} className="flex items-end gap-[3px] h-8">
            {Array.from({ length: BAR_COUNT }, (_, i) => (
                <div
                    key={i}
                    className={`w-1.5 h-7 rounded-full origin-bottom will-change-transform ${barColor}`}
                    style={{ transform: `scaleY(${IDLE_SCALE})` }}
                />
            ))}
        </div>
    );
}
