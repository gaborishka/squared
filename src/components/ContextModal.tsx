import React from 'react';
import { X } from 'lucide-react';

interface ContextModalProps {
    isOpen: boolean;
    onClose: () => void;
    contextText: string;
    setContextText: (text: string) => void;
    title: string;
}

export function ContextModal({ isOpen, onClose, contextText, setContextText, title }: ContextModalProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div
                className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex justify-between items-center px-6 py-4 border-b border-zinc-800 bg-zinc-900/50">
                    <h3 className="text-lg font-semibold text-zinc-100">{title}</h3>
                    <button
                        onClick={onClose}
                        className="text-zinc-400 hover:text-white transition-colors p-1 rounded-md hover:bg-zinc-800"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6">
                    <p className="text-sm text-zinc-400 mb-4">
                        Paste your speech points or context here so the AI can evaluate how well you cover them during the session.
                    </p>
                    <textarea
                        value={contextText}
                        onChange={(e) => setContextText(e.target.value)}
                        placeholder="e.g. 1. Introduction to the project&#10;2. Key features and benefits&#10;3. Call to action"
                        className="w-full h-64 bg-zinc-950/50 border border-zinc-800 rounded-xl p-4 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-none"
                        autoFocus
                    />
                </div>

                <div className="flex justify-end gap-3 px-6 py-4 border-t border-zinc-800 bg-zinc-900/50">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-white bg-indigo-500 hover:bg-indigo-600 rounded-lg transition-colors"
                    >
                        Save Context
                    </button>
                </div>
            </div>
        </div>
    );
}
