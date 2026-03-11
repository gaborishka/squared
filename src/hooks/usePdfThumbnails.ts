import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { api } from '../api/client';

GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).toString();

const THUMBNAIL_SCALE = 0.5;

export function usePdfThumbnails(projectId: string | null, fileType: string | null) {
  const [thumbnails, setThumbnails] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);

  useEffect(() => {
    if (!projectId || fileType !== 'pdf') {
      setThumbnails(new Map());
      return;
    }

    let cancelled = false;
    setLoading(true);

    async function render() {
      try {
        const url = api.getProjectFileUrl(projectId!);
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch PDF');
        const buffer = await response.arrayBuffer();

        const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise;
        pdfRef.current = pdf;

        const map = new Map<number, string>();

        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) break;
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: THUMBNAIL_SCALE });

          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;

          await page.render({ canvas, viewport }).promise;
          map.set(i, canvas.toDataURL('image/webp', 0.8));
          page.cleanup();
        }

        if (!cancelled) {
          setThumbnails(map);
        }
      } catch (err) {
        console.error('PDF thumbnail render failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void render();

    return () => {
      cancelled = true;
      pdfRef.current?.destroy();
      pdfRef.current = null;
    };
  }, [projectId, fileType]);

  return { thumbnails, loading };
}
