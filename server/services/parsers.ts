import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import type { ParsedUpload, ProjectFileType } from '../../shared/types.js';

const uploadsDir = path.resolve(process.cwd(), 'server/storage/uploads');

function inferFileType(fileName: string): ProjectFileType {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.pptx') return 'pptx';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.md') return 'md';
  return 'text';
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function cleanText(value: string): string {
  return value
    .replace(/\u0000/g, '')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function finalizeSlides(
  rawSlides: Array<{ slideNumber: number; title: string; content: string; speakerNotes: string }>,
): ParsedUpload['slides'] {
  return rawSlides.map((slide, index) => {
    const content = cleanText(slide.content);
    const title = cleanText(slide.title) || `Slide ${index + 1}`;
    return {
      slideNumber: slide.slideNumber,
      title,
      content,
      speakerNotes: cleanText(slide.speakerNotes),
    };
  });
}

function parseTextSlides(text: string): ParsedUpload['slides'] {
  const lines = text.split(/\r?\n/);
  const slides: Array<{ slideNumber: number; title: string; body: string[] }> = [];
  let current: { title: string; body: string[] } | null = null;

  const pushCurrent = () => {
    if (!current) return;
    const bodyText = cleanText(current.body.join('\n'));
    const title = cleanText(current.title || bodyText.split('\n')[0] || '');
    slides.push({
      slideNumber: slides.length + 1,
      title: title || `Slide ${slides.length + 1}`,
      body: bodyText ? [bodyText] : [],
    });
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const markdownHeading = trimmed.match(/^#{1,6}\s+(.+)$/);
    const numberedHeading = trimmed.match(/^(?:slide\s+\d+[:\-]|\d+[\.\)])\s+(.+)$/i);
    const colonHeading = trimmed.match(/^([A-Z][A-Za-z0-9 ,/&()-]{2,60}):$/);
    const heading = markdownHeading?.[1] ?? numberedHeading?.[1] ?? colonHeading?.[1] ?? null;

    if (heading) {
      pushCurrent();
      current = { title: heading, body: [] };
      continue;
    }

    if (!current) {
      current = { title: '', body: [] };
    }
    current.body.push(line);
  }

  pushCurrent();

  if (slides.length === 0) {
    const body = cleanText(text);
    return [
      {
        slideNumber: 1,
        title: body.split('\n')[0] || 'Speech Plan',
        content: body,
        speakerNotes: '',
      },
    ];
  }

  return slides.map((slide) => ({
    slideNumber: slide.slideNumber,
    title: slide.title,
    content: slide.body.join('\n'),
    speakerNotes: '',
  }));
}

function extractPptXmlTexts(xml: string): string[] {
  return Array.from(xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g))
    .map((match) => decodeXmlEntities(match[1]))
    .map((value) => value.trim())
    .filter(Boolean);
}

async function parsePptxSlides(buffer: Buffer): Promise<ParsedUpload['slides']> {
  const zip = await JSZip.loadAsync(buffer);
  const slideEntries = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((left, right) => {
      const leftNumber = Number(left.match(/slide(\d+)\.xml/i)?.[1] ?? 0);
      const rightNumber = Number(right.match(/slide(\d+)\.xml/i)?.[1] ?? 0);
      return leftNumber - rightNumber;
    });

  const slides: Array<{ slideNumber: number; title: string; content: string; speakerNotes: string }> = [];

  for (const entry of slideEntries) {
    const slideNumber = Number(entry.match(/slide(\d+)\.xml/i)?.[1] ?? slides.length + 1);
    const xml = await zip.file(entry)?.async('text');
    if (!xml) continue;
    const texts = extractPptXmlTexts(xml);
    const notesXml = await zip.file(`ppt/notesSlides/notesSlide${slideNumber}.xml`)?.async('text');
    const notesTexts = notesXml ? extractPptXmlTexts(notesXml) : [];
    slides.push({
      slideNumber,
      title: texts[0] ?? `Slide ${slideNumber}`,
      content: texts.slice(1).join('\n') || texts[0] || '',
      speakerNotes: notesTexts.join('\n'),
    });
  }

  return finalizeSlides(slides);
}

async function parsePdfSlides(buffer: Buffer): Promise<ParsedUpload['slides']> {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as {
    getDocument: (source: Record<string, unknown>) => { promise: Promise<any> };
  };
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  const slides: Array<{ slideNumber: number; title: string; content: string; speakerNotes: string }> = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const text = (textContent.items as Array<{ str?: string }>)
      .map((item) => item.str ?? '')
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    slides.push({
      slideNumber: pageNumber,
      title: text.split(/[.?!:]/)[0] || `Page ${pageNumber}`,
      content: text || `Page ${pageNumber}`,
      speakerNotes: '',
    });
  }

  return finalizeSlides(slides);
}

export async function parseUploadFile(projectId: string, file: Express.Multer.File): Promise<ParsedUpload> {
  await fs.mkdir(uploadsDir, { recursive: true });
  const fileType = inferFileType(file.originalname);
  const targetFileName = `${projectId}-${Date.now()}${path.extname(file.originalname).toLowerCase() || '.txt'}`;
  const filePath = path.resolve(uploadsDir, targetFileName);
  await fs.writeFile(filePath, file.buffer);

  let slides: ParsedUpload['slides'];
  let content: string;

  if (fileType === 'pptx') {
    slides = await parsePptxSlides(file.buffer);
  } else if (fileType === 'pdf') {
    slides = await parsePdfSlides(file.buffer);
  } else {
    const text = file.buffer.toString('utf8');
    slides = parseTextSlides(text);
  }

  content = slides
    .map((slide) => [slide.title, slide.content, slide.speakerNotes].filter(Boolean).join('\n'))
    .join('\n\n');

  return {
    fileType,
    content: cleanText(content),
    slideCount: slides.length,
    slides,
    filePath,
  };
}
