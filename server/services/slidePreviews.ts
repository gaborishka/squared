import fs from 'node:fs/promises';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';

const PREVIEW_WIDTH = 1600;
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: false,
});

type XmlNode = Record<string, any>;

interface SlideSize {
  cx: number;
  cy: number;
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TextBlock {
  html: string;
  fontSize: number;
  color: string;
  fontFamily: string;
  bold: boolean;
  align: 'left' | 'center' | 'right';
}

function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseXml<T>(xml: string): T {
  return parser.parse(xml) as T;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

function sanitizeFontFamily(value: string | undefined): string {
  if (!value) return 'Inter, system-ui, sans-serif';
  return `${value.replace(/"/g, "'")}, Inter, system-ui, sans-serif`;
}

function toHexColor(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const normalized = value.replace(/^#/, '').trim();
  if (/^[0-9a-f]{6}$/i.test(normalized)) return `#${normalized}`;
  return fallback;
}

function getSolidFillColor(node: XmlNode | undefined, fallback: string): string {
  return toHexColor(node?.solidFill?.srgbClr?.['@_val'], fallback);
}

function getBorderColor(node: XmlNode | undefined, fallback: string): string {
  return toHexColor(node?.ln?.solidFill?.srgbClr?.['@_val'], fallback);
}

function getBackgroundColor(slide: XmlNode): string {
  return toHexColor(slide?.sld?.cSld?.bg?.bgPr?.solidFill?.srgbClr?.['@_val'], '#0f172a');
}

function getPreviewDir(filePath: string): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}-previews`);
}

export function getSlidePreviewPath(filePath: string, slideNumber: number): string {
  return path.join(getPreviewDir(filePath), `slide-${slideNumber}.svg`);
}

function toPx(value: number, total: number, target: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  return Number(((value / total) * target).toFixed(2));
}

function scaleBounds(bounds: Bounds, size: SlideSize, targetHeight: number): Bounds {
  return {
    x: toPx(bounds.x, size.cx, PREVIEW_WIDTH),
    y: toPx(bounds.y, size.cy, targetHeight),
    width: toPx(bounds.width, size.cx, PREVIEW_WIDTH),
    height: toPx(bounds.height, size.cy, targetHeight),
  };
}

function getShapeBounds(node: XmlNode | undefined): Bounds | null {
  const xfrm = node?.spPr?.xfrm ?? node?.xfrm;
  const off = xfrm?.off;
  const ext = xfrm?.ext;
  if (!off || !ext) return null;
  return {
    x: Number(off['@_x'] ?? 0),
    y: Number(off['@_y'] ?? 0),
    width: Number(ext['@_cx'] ?? 0),
    height: Number(ext['@_cy'] ?? 0),
  };
}

function getTextFromParagraph(paragraph: XmlNode): string {
  const parts: string[] = [];
  for (const run of toArray(paragraph?.r)) {
    if (typeof run?.t === 'string') parts.push(run.t);
  }
  for (const field of toArray(paragraph?.fld)) {
    if (typeof field?.t === 'string') parts.push(field.t);
  }
  if (typeof paragraph?.t === 'string') parts.push(paragraph.t);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

function getParagraphRun(paragraph: XmlNode): XmlNode | null {
  return toArray(paragraph?.r)[0] ?? toArray(paragraph?.fld)[0] ?? null;
}

function isDarkColor(color: string): boolean {
  const normalized = color.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return true;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance < 0.45;
}

function buildTextBlocks(shape: XmlNode, fallbackColor: string): TextBlock[] {
  return toArray(shape?.txBody?.p)
    .map((paragraph) => {
      const text = getTextFromParagraph(paragraph);
      if (!text) return null;
      const run = getParagraphRun(paragraph);
      const runProps = run?.rPr ?? paragraph?.endParaRPr ?? {};
      const bulletChar = paragraph?.pPr?.buChar?.['@_char'] ?? null;
      const bulletPrefix = bulletChar ? `${bulletChar} ` : '';
      const alignValue = paragraph?.pPr?.['@_algn'];
      const align =
        alignValue === 'ctr' ? 'center' : alignValue === 'r' ? 'right' : 'left';
      const fontSize = clamp(Math.round((Number(runProps?.['@_sz'] ?? 1600) / 100) * 1.333), 16, 58);
      const color = toHexColor(runProps?.solidFill?.srgbClr?.['@_val'], fallbackColor);
      const fontFamily = sanitizeFontFamily(runProps?.latin?.['@_typeface']);
      const bold = runProps?.['@_b'] === '1';
      return {
        html: escapeHtml(`${bulletPrefix}${text}`),
        fontSize,
        color,
        fontFamily,
        bold,
        align,
      } satisfies TextBlock;
    })
    .filter((block): block is TextBlock => block != null);
}

function renderTextShape(shape: XmlNode, bounds: Bounds, slideBg: string): string | null {
  const textColor = isDarkColor(slideBg) ? '#e5e7eb' : '#111827';
  const blocks = buildTextBlocks(shape, textColor);
  if (blocks.length === 0) return null;

  const bodyAnchor = shape?.txBody?.bodyPr?.['@_anchor'];
  const justifyContent =
    bodyAnchor === 'ctr' ? 'center' : bodyAnchor === 'b' ? 'flex-end' : 'flex-start';

  const paragraphs = blocks
    .map((block) => {
      const style = [
        `margin:0 0 ${Math.max(6, Math.round(block.fontSize * 0.24))}px 0`,
        `font-size:${block.fontSize}px`,
        `line-height:${Math.max(1.08, Math.min(1.32, 1.18))}`,
        `font-family:${escapeAttribute(block.fontFamily)}`,
        `font-weight:${block.bold ? 700 : 500}`,
        `color:${block.color}`,
        `text-align:${block.align}`,
        'white-space:normal',
        'overflow-wrap:anywhere',
      ].join(';');
      return `<p style="${style}">${block.html}</p>`;
    })
    .join('');

  const wrapperStyle = [
    'width:100%',
    'height:100%',
    'display:flex',
    'flex-direction:column',
    `justify-content:${justifyContent}`,
    'overflow:hidden',
  ].join(';');

  return [
    `<foreignObject x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}">`,
    `<div xmlns="http://www.w3.org/1999/xhtml" style="${wrapperStyle}">`,
    paragraphs,
    '</div>',
    '</foreignObject>',
  ].join('');
}

function renderShapeFill(shape: XmlNode, bounds: Bounds): string | null {
  const fill = shape?.spPr;
  if (fill?.noFill != null) return null;
  const color = getSolidFillColor(fill, '');
  if (!color) return null;
  const stroke = getBorderColor(fill, 'transparent');
  const geom = shape?.spPr?.prstGeom?.['@_prst'];
  const radius = geom === 'roundRect' ? Math.min(bounds.width, bounds.height) * 0.14 : 20;
  return `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" rx="${radius}" fill="${color}" stroke="${stroke}" stroke-width="2" />`;
}

async function renderImageShape(
  shape: XmlNode,
  bounds: Bounds,
  relationships: Map<string, string>,
  zip: JSZip,
  slideEntry: string,
): Promise<string | null> {
  const relId = shape?.blipFill?.blip?.['@_embed'];
  if (!relId) return null;
  const target = relationships.get(relId);
  if (!target) return null;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(slideEntry), target));
  const file = zip.file(resolved);
  if (!file) return null;
  const ext = path.posix.extname(resolved).toLowerCase();
  const mime =
    ext === '.png' ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
        : ext === '.gif' ? 'image/gif'
          : ext === '.webp' ? 'image/webp'
            : ext === '.svg' ? 'image/svg+xml'
              : null;
  if (!mime) return null;
  const base64 = await file.async('base64');
  return `<image x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" preserveAspectRatio="xMidYMid meet" href="data:${mime};base64,${base64}" />`;
}

function renderChartPlaceholder(bounds: Bounds, slideBg: string): string {
  const cardFill = isDarkColor(slideBg) ? '#111827' : '#ffffff';
  const stroke = isDarkColor(slideBg) ? '#334155' : '#cbd5e1';
  const accent = isDarkColor(slideBg) ? '#818cf8' : '#6366f1';
  const labelColor = isDarkColor(slideBg) ? '#94a3b8' : '#64748b';
  const baseY = bounds.y + bounds.height * 0.76;
  const barWidth = bounds.width / 8;
  const gap = barWidth * 0.45;
  const bars = Array.from({ length: 5 }, (_, index) => {
    const height = bounds.height * (0.2 + index * 0.08);
    const x = bounds.x + bounds.width * 0.12 + index * (barWidth + gap);
    return `<rect x="${x}" y="${baseY - height}" width="${barWidth}" height="${height}" rx="${Math.min(12, barWidth / 3)}" fill="${accent}" opacity="${0.88 - index * 0.08}" />`;
  }).join('');

  return [
    `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" rx="28" fill="${cardFill}" stroke="${stroke}" stroke-width="2" />`,
    `<rect x="${bounds.x + bounds.width * 0.08}" y="${bounds.y + bounds.height * 0.12}" width="${bounds.width * 0.24}" height="${bounds.height * 0.08}" rx="12" fill="${accent}" opacity="0.16" />`,
    `<text x="${bounds.x + bounds.width * 0.11}" y="${bounds.y + bounds.height * 0.19}" fill="${labelColor}" font-size="${Math.max(22, bounds.height * 0.08)}" font-family="Inter, system-ui, sans-serif" font-weight="700">Chart</text>`,
    `<line x1="${bounds.x + bounds.width * 0.12}" y1="${baseY}" x2="${bounds.x + bounds.width * 0.9}" y2="${baseY}" stroke="${stroke}" stroke-width="3" />`,
    bars,
  ].join('');
}

function getCellText(cell: XmlNode): string {
  const paragraphs = toArray(cell?.txBody?.p);
  return paragraphs
    .map((paragraph) => getTextFromParagraph(paragraph))
    .filter(Boolean)
    .join(' ')
    .trim();
}

function renderTableFrame(frame: XmlNode, bounds: Bounds, slideBg: string): string {
  const table = frame?.graphic?.graphicData?.tbl;
  const rows = toArray(table?.tr).slice(0, 6);
  const cellRows = rows.map((row) => toArray(row?.tc).slice(0, 5).map(getCellText));
  const bg = isDarkColor(slideBg) ? '#0f172a' : '#ffffff';
  const stroke = isDarkColor(slideBg) ? '#334155' : '#cbd5e1';
  const text = isDarkColor(slideBg) ? '#e5e7eb' : '#0f172a';
  const subtext = isDarkColor(slideBg) ? '#94a3b8' : '#64748b';
  const fontSize = clamp(Math.round(bounds.height / 10), 14, 24);

  const rowsHtml = cellRows
    .map((cells, rowIndex) => {
      const cellHtml = cells
        .map((cell, cellIndex) => {
          const isHeader = rowIndex === 0;
          const style = [
            'border:1px solid rgba(148,163,184,0.24)',
            'padding:6px 8px',
            'overflow:hidden',
            'text-overflow:ellipsis',
            'white-space:nowrap',
            `font-weight:${isHeader ? 700 : 500}`,
            `color:${isHeader ? text : subtext}`,
            `background:${isHeader ? (isDarkColor(slideBg) ? 'rgba(99,102,241,0.16)' : 'rgba(99,102,241,0.08)') : 'transparent'}`,
            `text-align:${cellIndex === 0 ? 'left' : 'center'}`,
          ].join(';');
          return `<td style="${style}">${escapeHtml(cell || ' ')}</td>`;
        })
        .join('');
      return `<tr>${cellHtml}</tr>`;
    })
    .join('');

  const wrapperStyle = [
    `width:${bounds.width}px`,
    `height:${bounds.height}px`,
    'box-sizing:border-box',
    `padding:${Math.max(10, Math.round(bounds.height * 0.05))}px`,
    'overflow:hidden',
  ].join(';');

  const tableStyle = [
    'width:100%',
    'height:100%',
    'border-collapse:collapse',
    'table-layout:fixed',
    `font-size:${fontSize}px`,
    `font-family:${escapeAttribute('Inter, system-ui, sans-serif')}`,
    `background:${bg}`,
    `border:1px solid ${stroke}`,
    'border-radius:18px',
    'overflow:hidden',
  ].join(';');

  return [
    `<foreignObject x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}">`,
    `<div xmlns="http://www.w3.org/1999/xhtml" style="${wrapperStyle}">`,
    `<table style="${tableStyle}">${rowsHtml}</table>`,
    '</div>',
    '</foreignObject>',
  ].join('');
}

function renderGraphicFrame(frame: XmlNode, bounds: Bounds, slideBg: string): string {
  const graphicData = frame?.graphic?.graphicData;
  if (graphicData?.tbl) {
    return renderTableFrame(frame, bounds, slideBg);
  }
  return renderChartPlaceholder(bounds, slideBg);
}

function buildRelationships(xml: string | undefined): Map<string, string> {
  if (!xml) return new Map();
  const parsed = parseXml<XmlNode>(xml);
  const items = toArray(parsed?.Relationships?.Relationship);
  return new Map(items.map((item) => [String(item['@_Id']), String(item['@_Target'])]));
}

async function getSlideSize(zip: JSZip): Promise<SlideSize> {
  const presentationXml = zip.file('ppt/presentation.xml');
  if (!presentationXml) {
    return { cx: 9144000, cy: 5143500 };
  }
  const parsed = parseXml<XmlNode>(await presentationXml.async('text'));
  const cx = Number(parsed?.presentation?.sldSz?.['@_cx'] ?? 9144000);
  const cy = Number(parsed?.presentation?.sldSz?.['@_cy'] ?? 5143500);
  return { cx, cy };
}

async function renderSlideSvg(zip: JSZip, slideEntry: string, size: SlideSize): Promise<string> {
  const slideXml = await zip.file(slideEntry)?.async('text');
  if (!slideXml) throw new Error(`Missing slide XML: ${slideEntry}`);

  const slide = parseXml<XmlNode>(slideXml);
  const slideBg = getBackgroundColor(slide);
  const previewHeight = Math.round((PREVIEW_WIDTH / size.cx) * size.cy);
  const relationshipsXml = await zip.file(`${path.posix.dirname(slideEntry)}/_rels/${path.posix.basename(slideEntry)}.rels`)?.async('text');
  const relationships = buildRelationships(relationshipsXml);
  const tree = slide?.sld?.cSld?.spTree ?? {};

  const parts: string[] = [
    `<rect x="0" y="0" width="${PREVIEW_WIDTH}" height="${previewHeight}" rx="36" fill="${slideBg}" />`,
  ];

  for (const shape of toArray(tree?.sp)) {
    const rawBounds = getShapeBounds(shape);
    if (!rawBounds || rawBounds.width <= 0 || rawBounds.height <= 0) continue;
    const bounds = scaleBounds(rawBounds, size, previewHeight);
    const fillSvg = renderShapeFill(shape, bounds);
    if (fillSvg) parts.push(fillSvg);
    const textSvg = renderTextShape(shape, bounds, slideBg);
    if (textSvg) parts.push(textSvg);
  }

  for (const frame of toArray(tree?.graphicFrame)) {
    const rawBounds = getShapeBounds(frame);
    if (!rawBounds || rawBounds.width <= 0 || rawBounds.height <= 0) continue;
    const bounds = scaleBounds(rawBounds, size, previewHeight);
    parts.push(renderGraphicFrame(frame, bounds, slideBg));
  }

  for (const picture of toArray(tree?.pic)) {
    const rawBounds = getShapeBounds(picture);
    if (!rawBounds || rawBounds.width <= 0 || rawBounds.height <= 0) continue;
    const bounds = scaleBounds(rawBounds, size, previewHeight);
    const imageSvg = await renderImageShape(picture, bounds, relationships, zip, slideEntry);
    if (imageSvg) parts.push(imageSvg);
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PREVIEW_WIDTH}" height="${previewHeight}" viewBox="0 0 ${PREVIEW_WIDTH} ${previewHeight}" fill="none">`,
    parts.join(''),
    '</svg>',
  ].join('');
}

export async function createPptxSlidePreviews(buffer: Buffer, filePath: string): Promise<void> {
  const zip = await JSZip.loadAsync(buffer);
  const slideEntries = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((left, right) => {
      const leftNumber = Number(left.match(/slide(\d+)\.xml/i)?.[1] ?? 0);
      const rightNumber = Number(right.match(/slide(\d+)\.xml/i)?.[1] ?? 0);
      return leftNumber - rightNumber;
    });

  if (slideEntries.length === 0) return;

  const size = await getSlideSize(zip);
  const previewDir = getPreviewDir(filePath);
  await fs.mkdir(previewDir, { recursive: true });

  for (const slideEntry of slideEntries) {
    const slideNumber = Number(slideEntry.match(/slide(\d+)\.xml/i)?.[1] ?? 0);
    if (!slideNumber) continue;
    const svg = await renderSlideSvg(zip, slideEntry, size);
    await fs.writeFile(getSlidePreviewPath(filePath, slideNumber), svg, 'utf8');
  }
}
