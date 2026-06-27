export const uploadToR2 = async (file: File, folder: string) => {
    let impersonateId = null;
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      impersonateId = urlParams.get('impersonate');
    }

    let fileToUpload = file;

    // A. Intercept Images: Compress client-side first if not already compressed
    if (file.type.startsWith('image/') && !(file as any).isCompressed) {
      try {
        console.log(`[uploadToR2] Automatically compressing image: ${file.name}`);
        const compressed = await compressImage(file);
        fileToUpload = compressed;
      } catch (e) {
        console.error('[uploadToR2] Browser image compression failed, uploading original:', e);
      }
    }

    // B. Videos: Upload directly via signed URL (same as images)
    // Server-side ffmpeg compression is not available on Vercel serverless.
    if (file.type.startsWith('video/')) {
      console.log(`[uploadToR2] Uploading video directly via signed URL: ${file.name}`);
      // Fall through to the standard signed-URL upload below
    }


    // C. Proceed with standard R2 signed URL upload for compressed images & other files
    // 1. Get Signed URL from our API
    const res = await fetch('/api/upload/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: fileToUpload.name,
        fileType: fileToUpload.type,
        folder: folder,
        impersonateId: impersonateId || null
      })
    })
    
    if (!res.ok) throw new Error('Failed to get upload permission')
    const { signedUrl, publicUrl } = await res.json()
  
    // 2. Upload directly to Cloudflare R2
    const uploadRes = await fetch(signedUrl, {
      method: 'PUT',
      body: fileToUpload,
      headers: {
        'Content-Type': fileToUpload.type
      }
    })
  
    if (!uploadRes.ok) throw new Error('Upload to storage failed')
  
    return publicUrl
  }

export const compressImage = (file: File, quality = 0.7, maxWidth = 1200): Promise<File> => {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !file.type.startsWith('image/')) {
      return resolve(file); // Safe fallback for server-side or non-image files
    }

    if ((file as any).isCompressed) {
      return resolve(file);
    }

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.src = objectUrl;

    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height = (maxWidth / width) * height;
        width = maxWidth;
      }

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        return resolve(file); // Fallback if 2d context is unsupported
      }
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob((blob) => {
        URL.revokeObjectURL(objectUrl);
        if (blob) {
          const baseName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
          const compressedFile = new File([blob], `${baseName}.jpg`, {
            type: 'image/jpeg',
            lastModified: Date.now(),
          });
          (compressedFile as any).isCompressed = true;
          resolve(compressedFile);
        } else {
          resolve(file); // Fallback to original file
        }
      }, 'image/jpeg', quality);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      const fallbackFile = new File([file], file.name, { type: file.type });
      (fallbackFile as any).isCompressed = true; // prevent re-compression attempts
      resolve(fallbackFile);
    };
  });
};