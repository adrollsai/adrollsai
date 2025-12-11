export const uploadToR2 = async (file: File, folder: string) => {
    // 1. Get Signed URL from our API
    const res = await fetch('/api/upload/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: file.name,
        fileType: file.type,
        folder: folder
      })
    })
    
    if (!res.ok) throw new Error('Failed to get upload permission')
    const { signedUrl, publicUrl } = await res.json()
  
    // 2. Upload directly to Cloudflare R2
    const uploadRes = await fetch(signedUrl, {
      method: 'PUT',
      body: file,
      headers: {
        'Content-Type': file.type
      }
    })
  
    if (!uploadRes.ok) throw new Error('Upload to storage failed')
  
    return publicUrl
  }