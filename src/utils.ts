export function rad(degrees: number): number
{
   return degrees * Math.PI / 180;
}

export function deg(radians: number): number
{
  return radians * 180 / Math.PI;
}

//// FILE UTILS ////

/** Save data to file (works in Node.js and browser) */
export async function save(filepath: string, data: string | Buffer | Uint8Array | ArrayBuffer): void
{
    // Detect environment
    if (typeof window === 'undefined')
    {
        // Node.js
        const fs = await import('fs');
        const path = await import('path');
        
        const dir = path.dirname(filepath);
        if (!fs.existsSync(dir))
        {
            fs.mkdirSync(dir, { recursive: true });
        }

        await fs.promises.writeFile(filepath, data);
        console.log(`Saved to: ${filepath}`);
    } 
    else {
        // Browser
        let blob: Blob;
        
        if (data instanceof Blob) {
            blob = data;
        } else if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
            blob = new Blob([data]);
        } else {
            blob = new Blob([data], { type: 'text/plain' });
        }
        
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filepath.split('/').pop() || 'download';
        
        document.body.appendChild(link);
        link.click();
        
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }
}