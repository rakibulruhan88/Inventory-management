import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { createWorker, OEM, PSM } from 'tesseract.js';
import type { Worker } from 'tesseract.js';
import {
  DocumentReadError,
  type DocumentLine,
  type DocumentPage,
  type DocumentCell,
  type DocumentSpan,
  type ExtractedDocument,
  type ReaderOptions,
} from './document-types.js';

import { preprocessInvoiceImage } from './image-preprocessing.js';
import { invoiceGridCells } from './ocr-grid.js';
import { findStructuralLabels } from './structural-labels.js';
const require = createRequire(import.meta.url);
export function nativeTextUsable(text: string) {
  const anchors = [
    'contract',
    'order\\s+list',
    'item\\s*(?:no|code)',
    'description',
    'color\\s*code',
    'meter|metre',
    'rolls?',
  ];
  const count = anchors.filter((anchor) =>
    new RegExp(`\\b(?:${anchor})\\b`, 'i').test(text),
  ).length;
  const colorRow = /[A-Z0-9]+\s*#\s*[A-Za-z][^\n]+\d+(?:\.\d+)?\s+\d+/i.test(
    text,
  );
  const summary =
    /total\s*(?:meter|metre)s?\s*[:：]?\s*\d/i.test(text) &&
    /total\s*rolls?\s*[:：]?\s*\d/i.test(text);
  const tableHeading = /item\s*(?:no|code)|color\s*code/i.test(text);
  return (
    colorRow ||
    summary ||
    (text.trim().length >= 40 && count >= 3 && !tableHeading)
  );
}

export function imageDimensions(bytes: Buffer, mime: string) {
  if (mime === 'image/png' && bytes.length >= 24)
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (mime === 'image/jpeg') {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker) &&
        length >= 7
      )
        return {
          width: bytes.readUInt16BE(offset + 5),
          height: bytes.readUInt16BE(offset + 3),
        };
      offset += length;
    }
  }
  throw new DocumentReadError(
    'INVALID_IMAGE',
    'The image is damaged or cannot be read. Choose another JPG or PNG.',
  );
}

// Retain cell/word geometry instead of flattening it before table recognition.
export function groupPositionedSpans(spans: DocumentSpan[]) {
  const sorted = spans
    .filter((span) => span.text.trim())
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: { y: number; height: number; spans: DocumentSpan[] }[] = [];
  for (const span of sorted) {
    const previous = rows.at(-1);
    if (
      previous &&
      Math.abs(previous.y - span.y) <=
        Math.max(0.5, Math.min(previous.height, span.height) * 0.6)
    )
      previous.spans.push(span);
    else rows.push({ y: span.y, height: span.height, spans: [span] });
  }
  return rows.map((row) => {
    const spans = row.spans.sort((a, b) => a.x - b.x);
    return { text: spans.map((span) => span.text).join('  '), spans };
  });
}
export function groupedOcrCells(spans: DocumentSpan[]) {
  const cells: DocumentSpan[] = [];
  for (const span of spans) {
    const previous = cells.at(-1);
    const gap = previous ? span.x - previous.x - previous.width : Infinity;
    if (
      previous &&
      gap >= 0 &&
      gap <= Math.min(previous.height, span.height) * 0.6
    ) {
      previous.text += ' ' + span.text;
      if (span.confidence !== undefined)
        previous.confidence = Math.min(
          previous.confidence ?? 100,
          span.confidence,
        );
      previous.width = span.x + span.width - previous.x;
    } else cells.push({ ...span });
  }
  return cells;
}
export function nativePositionedLines(
  items: { str: string; transform: number[]; height: number; width: number }[],
) {
  return groupPositionedSpans(
    items.map((item) => ({
      text: item.str,
      x: item.transform[4],
      y: -item.transform[5],
      width: item.width,
      height: item.height,
    })),
  );
}
export function positionedLines(
  items: { str: string; transform: number[]; height: number; width: number }[],
) {
  return nativePositionedLines(items).map((line) => line.text);
}

export async function readDocument(
  bytes: Buffer,
  mime: string,
  options: ReaderOptions,
): Promise<ExtractedDocument> {
  let worker: Worker | undefined;
  const lines: DocumentLine[] = [];
  const pages: DocumentPage[] = [];
  const warnings: ExtractedDocument['warnings'] = [];
  let textLength = 0;
  const addLines = (
    text: {
      text: string;
      spans?: DocumentSpan[];
      cellSpans?: DocumentSpan[];
    }[],
    page: number,
    method: DocumentLine['method'],
  ) => {
    textLength += text.map((line) => line.text).join('\n').length;
    if (textLength > options.maxTextLength)
      throw new DocumentReadError(
        'TEXT_LIMIT',
        'The document contains too much text.',
      );
    text.forEach((row, index) =>
      lines.push({ ...row, page, line: index + 1, method }),
    );
  };
  const ocr = async (image: Buffer, page: number) => {
    if (!worker) {
      const languageRoot = dirname(
        require.resolve('@tesseract.js-data/eng/package.json'),
      );
      worker = await createWorker('eng', OEM.LSTM_ONLY, {
        langPath: join(languageRoot, '4.0.0'),
        gzip: true,
        cacheMethod: 'none',
      });
      await worker.setParameters({ preserve_interword_spaces: '1' });
    }
    let prepared = await preprocessInvoiceImage(image, options.maxPixels);
    let grid = invoiceGridCells(
      prepared.rules,
      prepared.width,
      prepared.height,
    );
    await worker.setParameters({
      tessedit_pageseg_mode: grid.length ? PSM.AUTO : PSM.SINGLE_BLOCK,
      user_defined_dpi: '300',
    });
    let result = await worker.recognize(
      prepared.bytes,
      {},
      { text: true, blocks: true },
    );
    const orientationScore = (text: string) =>
      new Set(
        findStructuralLabels(
          text,
          [
            'invoice',
            'contract',
            'supplier',
            'table',
            'item',
            'description',
            'color',
            'meter',
            'rolls',
          ],
          true,
        ).map((m) => m.role),
      ).size;
    let score = orientationScore(result.data.text);
    if (score < 4) {
      // Orientation is selected solely by invoice structure, never expected
      // supplier names, codes, or numbers. At most three bounded extra passes.
      for (const turn of [1, 2, 3]) {
        const candidate = await preprocessInvoiceImage(
          image,
          options.maxPixels,
          turn,
        );
        await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
        const read = await worker.recognize(
          candidate.bytes,
          {},
          { text: true, blocks: true },
        );
        const candidateScore = orientationScore(read.data.text);
        if (candidateScore >= 4 && candidateScore > score + 1) {
          prepared.canvas.width = 1;
          prepared.canvas.height = 1;
          prepared = candidate;
          result = read;
          score = candidateScore;
          grid = invoiceGridCells(
            prepared.rules,
            prepared.width,
            prepared.height,
          );
          break;
        }
        candidate.canvas.width = 1;
        candidate.canvas.height = 1;
      }
    }
    const toSpans = (data: typeof result.data) =>
      (
        data.blocks?.flatMap((block) =>
          block.paragraphs.flatMap((paragraph) =>
            paragraph.lines.flatMap((line) => line.words),
          ),
        ) ?? []
      ).map((word) => ({
        text: word.text,
        x: word.bbox.x0,
        y: (word.bbox.y0 + word.bbox.y1) / 2,
        width: word.bbox.x1 - word.bbox.x0,
        height: word.bbox.y1 - word.bbox.y0,
        confidence: word.confidence,
      }));
    let spans: DocumentSpan[] = toSpans(result.data);
    const cells: DocumentCell[] = [];
    if (grid.length) {
      // Physical ruled cells independently segment merged Item/Description cells
      // and each color/numeric row. No role or business value is assumed here.
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
      for (const box of grid) {
        const crop = createCanvas(Math.ceil(box.width), Math.ceil(box.height));
        crop
          .getContext('2d')
          .drawImage(
            prepared.canvas,
            box.x,
            box.y,
            box.width,
            box.height,
            0,
            0,
            crop.width,
            crop.height,
          );
        const cell = await worker.recognize(
          crop.toBuffer('image/png'),
          {},
          { text: true, blocks: true },
        );
        crop.width = 1;
        crop.height = 1;
        const words = toSpans(cell.data).map((span) => ({
          ...span,
          x: span.x + box.x,
          y: span.y + box.y,
        }));
        cells.push({
          ...box,
          text: groupPositionedSpans(words)
            .map((line) => line.text)
            .join(' '),
          spans: words,
        });
      }
      const inside = (span: DocumentSpan) =>
        grid.some(
          (box) =>
            span.x >= box.x - 3 &&
            span.x < box.x + box.width + 3 &&
            span.y >= box.y - 3 &&
            span.y < box.y + box.height + 3,
        );
      spans = [
        ...spans.filter((span) => !inside(span)),
        ...cells.flatMap((cell) => cell.spans),
      ];
    }
    prepared.canvas.width = 1;
    prepared.canvas.height = 1;
    const positioned = groupPositionedSpans(spans);
    pages.push({
      page,
      method: 'OCR',
      width: prepared.width,
      height: prepared.height,
      rules: prepared.rules,
      cells,
    });
    addLines(
      positioned.length
        ? positioned.map((line) => ({
            ...line,
            cellSpans: groupedOcrCells(line.spans),
          }))
        : result.data.text.split(/\r?\n/).map((text) => ({ text })),
      page,
      'OCR',
    );
  };
  try {
    if (mime !== 'application/pdf') {
      const { width, height } = imageDimensions(bytes, mime);
      if (!width || !height || width * height > options.maxPixels)
        throw new DocumentReadError(
          'IMAGE_TOO_LARGE',
          'The image dimensions exceed the safe document limit. Use an image below 16 million pixels.',
        );
      await ocr(bytes, 1);
    } else {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const pdfRoot = dirname(require.resolve('pdfjs-dist/package.json'));
      const task = pdfjs.getDocument({
        data: new Uint8Array(bytes),
        useSystemFonts: false,
        stopAtErrors: true,
        maxImageSize: options.maxPixels,
        standardFontDataUrl: join(pdfRoot, 'standard_fonts') + '/',
        cMapUrl: join(pdfRoot, 'cmaps') + '/',
        cMapPacked: true,
        wasmUrl: join(pdfRoot, 'wasm') + '/',
      });
      try {
        const pdf = await task.promise;
        if (pdf.numPages > options.maxPages)
          throw new DocumentReadError(
            'PAGE_LIMIT',
            `The PDF has too many pages. The limit is ${options.maxPages}.`,
          );
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          const page = await pdf.getPage(pageNumber);
          try {
            let text: { text: string; spans?: DocumentSpan[] }[] = [];
            try {
              const content = await page.getTextContent();
              text = nativePositionedLines(
                content.items.filter(
                  (
                    item,
                  ): item is import('pdfjs-dist/types/src/display/api.js').TextItem =>
                    'str' in item,
                ),
              );
            } catch {
              warnings.push({
                code: 'PDF_TEXT_FAILED',
                message:
                  'Native text could not be read on this page; OCR was used.',
                page: pageNumber,
              });
            }
            if (nativeTextUsable(text.map((line) => line.text).join('\n'))) {
              const viewport = page.getViewport({ scale: 1 });
              pages.push({
                page: pageNumber,
                method: 'PDF_TEXT',
                width: viewport.width,
                height: viewport.height,
                rules: [],
              });
              addLines(text, pageNumber, 'PDF_TEXT');
            } else {
              const viewport = page.getViewport({ scale: 2 });
              const width = Math.ceil(viewport.width),
                height = Math.ceil(viewport.height);
              if (
                !Number.isFinite(width * height) ||
                width < 1 ||
                height < 1 ||
                width * height > options.maxPixels
              )
                throw new DocumentReadError(
                  'PAGE_IMAGE_LIMIT',
                  'A PDF page is too large to read safely.',
                );
              const canvas = createCanvas(width, height);
              await page.render({
                canvas: canvas as unknown as HTMLCanvasElement,
                canvasContext: canvas.getContext(
                  '2d',
                ) as unknown as CanvasRenderingContext2D,
                viewport,
              }).promise;
              await ocr(canvas.toBuffer('image/png'), pageNumber);
              canvas.width = 1;
              canvas.height = 1;
            }
          } finally {
            page.cleanup();
          }
        }
      } finally {
        await task.destroy();
      }
    }
    const methods = new Set(lines.map((l) => l.method));
    return {
      lines,
      pages,
      method:
        methods.size > 1
          ? 'HYBRID'
          : methods.has('PDF_TEXT')
            ? 'PDF_TEXT'
            : 'OCR',
      warnings,
    };
  } finally {
    await worker?.terminate();
  }
}
