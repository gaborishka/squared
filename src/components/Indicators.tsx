import { Eye, Activity, User, MessageSquare } from 'lucide-react';

export function Indicators({ data }: { data: any }) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center text-sm text-zinc-400">
          <Activity className="w-4 h-4 mr-2" /> Pace
        </div>
        <div className="text-zinc-100 font-medium bg-zinc-950 px-4 py-2 rounded-xl border border-zinc-800">
          {data.pace || 'Analyzing...'}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center text-sm text-zinc-400">
          <Eye className="w-4 h-4 mr-2" /> Eye Contact
        </div>
        <div className="text-zinc-100 font-medium bg-zinc-950 px-4 py-2 rounded-xl border border-zinc-800">
          {data.eyeContact || 'Analyzing...'}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center text-sm text-zinc-400">
          <User className="w-4 h-4 mr-2" /> Posture
        </div>
        <div className="text-zinc-100 font-medium bg-zinc-950 px-4 py-2 rounded-xl border border-zinc-800">
          {data.posture || 'Analyzing...'}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center text-sm text-zinc-400">
          <MessageSquare className="w-4 h-4 mr-2" /> Filler Words
        </div>
        <div className="text-zinc-100 font-medium bg-zinc-950 px-4 py-2 rounded-xl border border-zinc-800 text-2xl">
          {data.fillerWordsCount ?? 0}
        </div>
      </div>
      
      {data.feedbackMessage && (
        <div className="mt-6 p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-300 text-sm">
          {data.feedbackMessage}
        </div>
      )}
    </div>
  );
}
