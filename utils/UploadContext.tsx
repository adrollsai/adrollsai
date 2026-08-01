'use client'

import React, { createContext, useContext, useState, useRef } from 'react'
import { createClient } from '@/utils/supabase/client'
import { compressImage } from '@/utils/upload-helper'
import { toast } from 'sonner'

export interface UploadTask {
    id: string
    fileName: string
    progress: number
    status: 'compressing' | 'uploading' | 'processing' | 'completed' | 'failed'
    error?: string
    type: 'image' | 'video'
}

export interface FileUploadItem {
    file: File;
    propertyId?: string;
    customInstructions?: string;
}

interface UploadContextType {
    tasks: UploadTask[]
    uploadAssets: (
        files: FileList | File[] | FileUploadItem[],
        targetUserId: string,
        impersonateId: string | null,
        propertyId?: string,
        customInstructions?: string
    ) => void
    clearCompletedTasks: () => void
    removeTask: (id: string) => void
    hasActiveTasks: boolean
    subscribeToCompletion: (callback: () => void) => () => void
}

const UploadContext = createContext<UploadContextType | undefined>(undefined)

export const useUpload = () => {
    const context = useContext(UploadContext)
    if (!context) throw new Error('useUpload must be used within an UploadProvider')
    return context
}

export const UploadProvider = ({ children }: { children: React.ReactNode }) => {
    const [tasks, setTasks] = useState<UploadTask[]>([])
    const supabase = createClient()
    const activeUploadsCount = useRef(0)
    const taskQueueRef = useRef<{ file: File; id: string; targetUserId: string; impersonateId: string | null; propertyId?: string; customInstructions?: string }[]>([])
    const completionCallbacks = useRef<Set<() => void>>(new Set())

    const subscribeToCompletion = (callback: () => void) => {
        completionCallbacks.current.add(callback)
        return () => {
            completionCallbacks.current.delete(callback)
        }
    }

    const notifyCompletion = () => {
        completionCallbacks.current.forEach(cb => {
            try {
                cb()
            } catch (e) {
                console.error('[UploadContext] Error in completion callback:', e)
            }
        })
    }

    const clearCompletedTasks = () => {
        setTasks(prev => prev.filter(t => t.status !== 'completed' && t.status !== 'failed'))
    }

    const removeTask = (id: string) => {
        setTasks(prev => prev.filter(t => t.id !== id))
    }

    const hasActiveTasks = tasks.some(t => ['compressing', 'uploading', 'processing'].includes(t.status))

    const uploadAssets = (
        files: FileList | File[] | FileUploadItem[],
        targetUserId: string,
        impersonateId: string | null,
        globalPropertyId?: string,
        globalInstructions?: string
    ) => {
        const fileList = Array.from(files as any)
        if (fileList.length === 0) return

        const items: FileUploadItem[] = fileList.map((item: any) => {
            if (item instanceof File) {
                return { file: item, propertyId: globalPropertyId, customInstructions: globalInstructions };
            } else if (item && item.file instanceof File) {
                return {
                    file: item.file,
                    propertyId: item.propertyId !== undefined ? item.propertyId : globalPropertyId,
                    customInstructions: item.customInstructions !== undefined ? item.customInstructions : globalInstructions
                };
            }
            return { file: item, propertyId: globalPropertyId, customInstructions: globalInstructions };
        });

        const MAX_FILE_SIZE = 1024 * 1024 * 1024 // 1GB
        const validItems = items.filter(item => {
            if (item.file.size > MAX_FILE_SIZE) {
                toast.error(`File "${item.file.name}" is too large. Videos and photos larger than 1GB are not permitted.`);
                return false
            }
            return true
        })

        if (validItems.length === 0) return

        const newTasks: UploadTask[] = validItems.map(item => ({
            id: crypto.randomUUID(),
            fileName: item.file.name,
            progress: 0,
            status: item.file.type.startsWith('image/') ? 'compressing' : 'uploading',
            type: item.file.type.startsWith('video/') ? 'video' : 'image'
        }))

        setTasks(prev => [...prev, ...newTasks])

        // Add to queue
        validItems.forEach((item, index) => {
            taskQueueRef.current.push({
                file: item.file,
                id: newTasks[index].id,
                targetUserId,
                impersonateId,
                propertyId: item.propertyId,
                customInstructions: item.customInstructions
            })
        })

        // Trigger processing
        processQueue()
    }

    const processQueue = () => {
        const MAX_CONCURRENT = 2
        while (activeUploadsCount.current < MAX_CONCURRENT && taskQueueRef.current.length > 0) {
            const nextTask = taskQueueRef.current.shift()
            if (nextTask) {
                activeUploadsCount.current++
                executeUpload(nextTask)
            }
        }
    }

    const updateTask = (id: string, updates: Partial<UploadTask>) => {
        setTasks(prev => prev.map(t => (t.id === id ? { ...t, ...updates } : t)))
    }

    const executeUpload = async (task: { file: File; id: string; targetUserId: string; impersonateId: string | null; propertyId?: string; customInstructions?: string }) => {
        const { file, id, targetUserId, impersonateId, propertyId, customInstructions } = task
        let currentFile = file

        try {
            // A. COMPRESSION STAGE
            if (file.type.startsWith('image/')) {
                updateTask(id, { status: 'compressing', progress: 5 })
                try {
                    currentFile = await compressImage(file)
                    updateTask(id, { progress: 10 })
                } catch (e) {
                    console.warn(`[UploadContext] Image compression failed for ${file.name}, uploading original.`, e)
                }
            }

            // B. GET SIGNED URL
            // Videos go to 'temp/raw-videos' first, images go to 'library'
            const isVideo = file.type.startsWith('video/')
            const folder = isVideo ? 'temp/raw-videos' : 'library'

            const signRes = await fetch('/api/upload/sign', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fileName: currentFile.name,
                    fileType: currentFile.type,
                    folder,
                    impersonateId
                })
            })

            if (!signRes.ok) throw new Error('Secure upload signature rejected by server.')
            const { signedUrl, publicUrl } = await signRes.json()

            // C. UPLOAD TO R2 (via XHR for real-time progress)
            updateTask(id, { status: 'uploading', progress: 15 })

            await new Promise<void>((resolve, reject) => {
                const xhr = new XMLHttpRequest()
                xhr.open('PUT', signedUrl)
                xhr.setRequestHeader('Content-Type', currentFile.type)

                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable) {
                        // Map R2 upload to 15% - 85% range
                        const pct = Math.round((e.loaded / e.total) * 70) + 15
                        updateTask(id, { progress: pct })
                    }
                }

                xhr.onload = () => {
                    if (xhr.status === 200) {
                        resolve()
                    } else {
                        reject(new Error(`Storage server rejected upload: HTTP ${xhr.status}`))
                    }
                }

                xhr.onerror = () => reject(new Error('Network connection to storage server failed.'))
                xhr.send(currentFile)
            })

            // D. PROCESSING / REGISTRATION STAGE
            if (isVideo) {
                updateTask(id, { status: 'processing', progress: 90 })

                // Trigger serverless video compression endpoint (with 1 retry for transient network errors)
                let compressRes: Response | null = null;
                for (let attempt = 1; attempt <= 2; attempt++) {
                    try {
                        compressRes = await fetch('/api/assets/compress', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                tempUrl: publicUrl,
                                fileName: currentFile.name,
                                fileType: currentFile.type,
                                fileSize: currentFile.size,
                                impersonateId,
                                propertyId,
                                customInstructions
                            })
                        })
                        if (compressRes.ok) break;
                    } catch (e) {}
                    if (attempt < 2) await new Promise(r => setTimeout(r, 1500));
                }

                if (!compressRes || !compressRes.ok) {
                    // Double check if background processing registered the asset in Supabase
                    const { data: existingAsset } = await supabase
                        .from('assets')
                        .select('id')
                        .eq('user_id', targetUserId)
                        .ilike('caption', `%${currentFile.name}%`)
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .maybeSingle();

                    if (!existingAsset) {
                        const errorData = compressRes ? await compressRes.json().catch(() => ({})) : {};
                        throw new Error(errorData.error || 'Serverless video optimization failed.')
                    }
                }
            } else {
                updateTask(id, { progress: 95 })
                // Register image directly in the Supabase assets table
                const { error: insertError } = await supabase
                    .from('assets')
                    .insert({
                        user_id: targetUserId,
                        type: 'image',
                        url: publicUrl,
                        status: 'Ready',
                        caption: `Uploaded: ${currentFile.name}`,
                        property_id: propertyId || null,
                        created_at: new Date().toISOString(),
                        metadata: {
                            custom_instructions: customInstructions || null
                        }
                    })

                if (insertError) throw new Error(`Database registration failed: ${insertError.message}`)
            }

            // Completed!
            updateTask(id, { status: 'completed', progress: 100 })
            notifyCompletion()
            setTimeout(() => {
                removeTask(id)
            }, 3000)

        } catch (err: any) {
            console.error(`[UploadContext] Task ${id} failed:`, err)
            updateTask(id, { status: 'failed', error: err.message || 'Unknown upload error.' })
            toast.error(`Upload failed: ${file.name}`)
        } finally {
            activeUploadsCount.current--
            processQueue()
        }
    }

    return (
        <UploadContext.Provider value={{ tasks, uploadAssets, clearCompletedTasks, removeTask, hasActiveTasks, subscribeToCompletion }}>
            {children}
        </UploadContext.Provider>
    )
}
