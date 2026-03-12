import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { authenticatedFetch } from '../api/client';
import type { ProjectDetails } from '../types';

GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).toString();

const THUMBNAIL_SCALE = 0.5;

export function useSlidePreviews(project: Pick<ProjectDetails, 'id' | 'fileType' | 'slides'> | null) {
  const [thumbnails, setThumbnails] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const objectUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];

    if (!project?.id || !project.fileType) {
      setThumbnails(new Map());
      setLoading(false);
      return;
    }

    let cancelled = false;
    const { id: projectId, fileType } = project;

    if (fileType === 'pptx') {
      setLoading(true);

      async function loadPptxPreviews() {
        try {
          const entries = await Promise.all(
            project.slides.map(async (slide) => {
              const response = await authenticatedFetch(`/api/projects/${projectId}/slides/${slide.slideNumber}/preview`);
              if (!response.ok) return null;

              const blob = await response.blob();
              const objectUrl = URL.createObjectURL(blob);
              objectUrlsRef.current.push(objectUrl);
              return [slide.slideNumber, objectUrl] as const;
            }),
          );

          if (!cancelled) {
            setThumbnails(new Map(entries.filter((entry): entry is readonly [number, string] => entry != null)));
          }
        } catch (err) {
          console.error('PPTX preview lookup failed:', err);
          if (!cancelled) setThumbnails(new Map());
        } finally {
          if (!cancelled) setLoading(false);
        }
      }

      void loadPptxPreviews();
      return;
    }

    if (fileType !== 'pdf') {
      setThumbnails(new Map());
      setLoading(false);
      return;
    }

    setLoading(true);

    async function render() {
      try {
        const response = await authenticatedFetch(`/api/projects/${projectId}/file`);
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
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current = [];
      pdfRef.current?.destroy();
      pdfRef.current = null;
    };
  }, [project]);

  return { thumbnails, loading };
}

export const usePdfThumbnails = useSlidePreviews;
