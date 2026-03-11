import { motion } from 'motion/react';

export function OverallScoreRing({ score, size = 96 }: { score: number; size?: number }) {
    const half = size / 2;
    const strokeWidth = Math.round(size * 0.07);
    const radius = half - strokeWidth;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (score / 100) * circumference;

    let color = '#10B981'; // emerald-500
    let label = 'Great';

    if (score < 40) {
        color = '#EF4444'; // red-500
        label = 'Needs work';
    } else if (score < 70) {
        color = '#F59E0B'; // amber-500
        label = 'Good';
    }

    return (
        <div className="flex flex-col items-center gap-1">
            <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
                <svg className="absolute w-full h-full -rotate-90" viewBox={`0 0 ${size} ${size}`}>
                    <circle
                        cx={half}
                        cy={half}
                        r={radius}
                        strokeWidth={strokeWidth}
                        stroke="#27272a"
                        fill="transparent"
                    />
                    <motion.circle
                        cx={half}
                        cy={half}
                        r={radius}
                        strokeWidth={strokeWidth}
                        stroke={color}
                        fill="transparent"
                        strokeLinecap="round"
                        initial={{ strokeDashoffset: circumference }}
                        animate={{ strokeDashoffset }}
                        transition={{ duration: 1, ease: 'easeOut' }}
                        style={{ strokeDasharray: circumference }}
                    />
                </svg>
                <div className="absolute flex flex-col items-center justify-center">
                    <span className="text-xl font-bold text-white leading-none">{Math.round(score)}</span>
                </div>
            </div>
            <span className="text-[10px] text-zinc-500 font-medium">{label}</span>
        </div>
    );
}
