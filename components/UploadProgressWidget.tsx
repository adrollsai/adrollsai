'use client'

import React, { useState } from 'react'
import { useUpload } from '@/utils/UploadContext'
import { X, ChevronDown, ChevronUp, UploadCloud, CheckCircle2, AlertCircle, Loader2, PlayCircle, Image as ImageIcon } from 'lucide-react'

export default function UploadProgressWidget() {
    const { tasks, clearCompletedTasks } = useUpload()
    const [isMinimized, setIsMinimized] = useState(false)

    if (tasks.length === 0) return null

    const activeTasks = tasks.filter(t => ['compressing', 'uploading', 'processing'].includes(t.status))
    const completedCount = tasks.filter(t => t.status === 'completed').length
    const failedCount = tasks.filter(t => t.status === 'failed').length
    const totalCount = tasks.length

    return (
        <div className="fixed bottom-6 right-6 z-[9999] w-full max-w-sm bg-white rounded-3xl border border-slate-200/80 shadow-2xl overflow-hidden animate-in slide-in-from-bottom duration-300 font-sans">
            {/* Header Control */}
            <div className="bg-slate-900 px-5 py-4 flex items-center justify-between text-white">
                <div className="flex items-center gap-2.5">
                    <UploadCloud size={20} className="text-blue-400 animate-pulse" />
                    <div>
                        <h4 className="text-sm font-extrabold tracking-tight">
                            {activeTasks.length > 0 ? `Uploading Assets (${completedCount}/${totalCount})` : 'Uploads Finished'}
                        </h4>
                        {activeTasks.length > 0 && (
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">
                                {activeTasks.length} in progress
                            </p>
                        )}
                    </div>
                </div>
                
                <div className="flex items-center gap-1.5">
                    <button 
                        onClick={() => setIsMinimized(!isMinimized)} 
                        className="p-1.5 hover:bg-white/10 rounded-full transition-colors text-slate-300 hover:text-white"
                        title={isMinimized ? 'Expand' : 'Minimize'}
                    >
                        {isMinimized ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                    {activeTasks.length === 0 && (
                        <button 
                            onClick={clearCompletedTasks} 
                            className="p-1.5 hover:bg-white/10 rounded-full transition-colors text-slate-300 hover:text-white"
                            title="Clear completed"
                        >
                            <X size={16} />
                        </button>
                    )}
                </div>
            </div>

            {/* Content List */}
            {!isMinimized && (
                <div className="max-h-72 overflow-y-auto p-4 space-y-3.5 bg-slate-50/50">
                    {tasks.map(task => (
                        <div key={task.id} className="bg-white p-3.5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-2.5">
                            <div className="flex items-start gap-3">
                                <div className="p-2 bg-slate-50 rounded-xl flex-shrink-0 text-slate-500 border border-slate-100">
                                    {task.type === 'video' ? <PlayCircle size={18} className="text-indigo-500" /> : <ImageIcon size={18} className="text-blue-500" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-start gap-2">
                                        <p className="text-xs font-bold text-slate-800 truncate" title={task.fileName}>
                                            {task.fileName}
                                        </p>
                                        <span className="text-[10px] font-black tabular-nums text-slate-500 shrink-0">
                                            {task.progress}%
                                        </span>
                                    </div>
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5 flex items-center gap-1">
                                        {task.status === 'compressing' && (
                                            <>
                                                <Loader2 size={10} className="animate-spin text-blue-500" />
                                                Compressing client-side...
                                            </>
                                        )}
                                        {task.status === 'uploading' && (
                                            <>
                                                <Loader2 size={10} className="animate-spin text-blue-500" />
                                                Uploading directly to cloud...
                                            </>
                                        )}
                                        {task.status === 'processing' && (
                                            <>
                                                <Loader2 size={10} className="animate-spin text-indigo-500" />
                                                Optimizing video serverless...
                                            </>
                                        )}
                                        {task.status === 'completed' && (
                                            <>
                                                <CheckCircle2 size={10} className="text-green-500" />
                                                <span className="text-green-600">Saved to library</span>
                                            </>
                                        )}
                                        {task.status === 'failed' && (
                                            <>
                                                <AlertCircle size={10} className="text-red-500" />
                                                <span className="text-red-600 truncate max-w-[200px]" title={task.error}>
                                                    {task.error || 'Failed'}
                                                </span>
                                            </>
                                        )}
                                    </p>
                                </div>
                            </div>

                            {/* Progress bar */}
                            {task.status !== 'completed' && task.status !== 'failed' && (
                                <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                                    <div 
                                        className={`h-full rounded-full transition-all duration-300 ${
                                            task.status === 'processing' 
                                                ? 'bg-gradient-to-r from-indigo-500 to-purple-500 animate-pulse' 
                                                : 'bg-gradient-to-r from-blue-500 to-sky-400'
                                        }`}
                                        style={{ width: `${task.progress}%` }}
                                    />
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
