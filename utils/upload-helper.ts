export const uploadToR2 = async (file: File, folder: string) => {
    let impersonateId = null;
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      impersonateId = urlParams.get('impersonate');
    }

    // 1. Get Signed URL from our API
    const res = await fetch('/api/upload/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: file.name,
        fileType: file.type,
        folder: folder,
        impersonateId: impersonateId || null
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

export const compressImage = (file: File, quality = 0.7, maxWidth = 1200): Promise<File> => {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !file.type.startsWith('image/')) {
      return resolve(file); // Safe fallback for server-side or non-image files
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
          resolve(compressedFile);
        } else {
          resolve(file); // Fallback to original file
        }
      }, 'image/jpeg', quality);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file); // Fallback to original file on loading error
    };
  });
};