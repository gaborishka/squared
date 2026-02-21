import { motion } from 'motion/react';

export function OverallScoreRing({ score }: { score: number }) {
    const radius = 36;
    const strokeWidth = 8;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (score / 100) * circumference;

    let color = '#10B981'; // emerald-500
    let label = 'Great performance';

    if (score < 40) {
        color = '#EF4444'; // red-500
        label = 'Needs work';
    } else if (score < 70) {
        color = '#F59E0B'; // amber-500
        label = 'Good progress';
    }

    return (
        <div className="flex flex-col items-center">
            <div className="relative flex items-center justify-center w-24 h-24 mb-2">
                {/* Background Ring */}
                <svg className="absolute w-full h-full transform -rotate-90">
                    <circle
                        cx="48"
                        cy="48"
                        r={radius}
                        strokeWidth={strokeWidth}
                        stroke="#27272a" // zinc-800
                        fill="transparent"
                    />
                    {/* Progress Ring */}
                    <motion.circle
                        cx="48"
                        cy="48"
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
                    <span className="text-2xl font-bold text-white leading-none">{Math.round(score)}</span>
                    <span className="text-[10px] text-zinc-400 font-medium mt-1">/ 100</span>
                </div>
            </div>
            <div className="text-sm font-medium text-zinc-300">{label}</div>
        </div>
    );
}
