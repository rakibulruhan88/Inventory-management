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
import {
  findStructuralLabels,
  matchStructuralLabel,
} from './structural-labels.js';
import { nativeTableCells, pdfTableGeometry } from './pdf-geometry.js';
import { numericCellConsensus } from './ocr-quality.js';
import { cropCellInk, removeCellEdgeRules } from './ocr-cell.js';
import { PaddleLineReader } from './paddle-line-reader.js';
import { confirmedLineReading } from './ocr-quality.js';
import { fullPagePdfImage } from './pdf-image.js';
const require = createRequire(import.meta.url);
export function nativeTextUsable(text: string) {
  // Broken font encodings can still contain recognizable headings. Render
  // these pages rather than trusting corrupt native values.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/.test(text)) return false;
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
  viewport?: { transform: number[]; scale: number },
) {
  return groupPositionedSpans(
    items.map((item) => {
      const matrix = viewport?.transform;
      const x = item.transform[4],
        y = item.transform[5];
      return {
        text: item.str,
        x: matrix ? matrix[0] * x + matrix[2] * y + matrix[4] : x,
        y: matrix
          ? matrix[1] * x +
            matrix[3] * y +
            matrix[5] -
            (item.height * viewport.scale) / 2
          : -y,
        width: item.width * (viewport?.scale ?? 1),
        height: item.height * (viewport?.scale ?? 1),
      };
    }),
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
  let paddle: PaddleLineReader | undefined;
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
      await worker.setParameters({
        preserve_interword_spaces: '1',
        thresholding_method: '2',
      });
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
    const orientationScore = (data: typeof result.data) => {
      const words =
        data.blocks
          ?.flatMap((block) =>
            block.paragraphs.flatMap((paragraph) =>
              paragraph.lines.flatMap((line) => line.words),
            ),
          )
          .filter((word) => word.text.length >= 3) ?? [];
      // AUTO may recognize sideways text while keeping its vertical boxes.
      // Cell crops need the actual raster upright, not just readable text.
      const upright = words.length
        ? words.filter(
            (word) =>
              word.bbox.x1 - word.bbox.x0 >= word.bbox.y1 - word.bbox.y0,
          ).length / words.length
        : 1;
      return (
        upright *
        new Set(
          findStructuralLabels(
            data.text,
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
        ).size
      );
    };
    let score = orientationScore(result.data);
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
        const candidateScore = orientationScore(read.data);
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
        const padding = 10;
        const crop = createCanvas(
          Math.ceil(box.width) + padding * 2,
          Math.ceil(box.height) + padding * 2,
        );
        const cropContext = crop.getContext('2d');
        cropContext.fillStyle = 'white';
        cropContext.fillRect(0, 0, crop.width, crop.height);
        crop
          .getContext('2d')
          .drawImage(
            prepared.canvas,
            box.x,
            box.y,
            box.width,
            box.height,
            padding,
            padding,
            box.width,
            box.height,
          );
        removeCellEdgeRules(crop, padding);
        prepared.canvas
          .getContext('2d')
          .drawImage(
            crop,
            padding,
            padding,
            box.width,
            box.height,
            box.x,
            box.y,
            box.width,
            box.height,
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
          x: span.x + box.x - padding,
          y: span.y + box.y - padding,
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
    // Specialize numeric fields before treating generic text as stock values.
    // Empty cells are included: an isolated "1" is often omitted by block OCR.
    // Read whole physical cells, so a dropped digit outside a word box survives.
    const numericHeaders = cells.filter((cell) =>
      matchStructuralLabel(cell.text, ['meter', 'rolls'], true),
    );
    const numericCells = cells
      .filter((cell) =>
        numericHeaders.some(
          (header) =>
            Math.abs(cell.x - header.x) < 4 &&
            cell.y >= header.y + header.height,
        ),
      )
      .slice(0, 128);
    for (const cell of numericCells) {
      const crop = cropCellInk(prepared.canvas, cell);
      if (!crop) continue;
      const reads = [];
      const mode =
        crop.inkWidth < crop.inkHeight * 0.8 ? PSM.RAW_LINE : PSM.SINGLE_LINE;
      for (const threshold of ['0', '2']) {
        await worker.setParameters({
          tessedit_pageseg_mode: mode,
          tessedit_char_whitelist: '0123456789.,',
          thresholding_method: threshold,
          preserve_interword_spaces: '0',
        });
        const read = await worker.recognize(
          crop.canvas.toBuffer('image/png'),
          {},
          { text: true, blocks: true },
        );
        reads.push({
          text: read.data.text.trim(),
          confidence: read.data.confidence ?? 0,
        });
      }
      try {
        paddle ??= await PaddleLineReader.create();
        const first = await paddle.read(crop.canvas.toBuffer('image/png'));
        const alternate = createCanvas(
          crop.canvas.width + 8,
          crop.canvas.height + 4,
        );
        let second;
        try {
          const ctx = alternate.getContext('2d');
          ctx.fillStyle = 'white';
          ctx.fillRect(0, 0, alternate.width, alternate.height);
          ctx.drawImage(crop.canvas, 4, 2);
          second = await paddle.read(alternate.toBuffer('image/png'));
        } finally {
          alternate.width = 1;
          alternate.height = 1;
        }
        const confirmed = confirmedLineReading(first, second);
        if (
          confirmed &&
          /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(confirmed.text)
        )
          reads.push(confirmed, confirmed);
      } catch {
        if (!warnings.some((w) => w.code === 'SECONDARY_OCR_UNAVAILABLE'))
          warnings.push({
            code: 'SECONDARY_OCR_UNAVAILABLE',
            message:
              'Some values could not be checked by the second reader. Review the highlighted fields against your invoice.',
            page,
          });
      }
      crop.canvas.width = 1;
      crop.canvas.height = 1;
      const original = {
        text: cell.text.trim(),
        confidence: cell.spans.length
          ? Math.min(...cell.spans.map((s) => s.confidence ?? 100))
          : 0,
      };
      const chosen = numericCellConsensus(original, reads);
      cell.text = chosen.text;
      cell.spans = chosen.text
        ? [
            {
              text: chosen.text,
              x: crop.x,
              y: crop.y + crop.inkHeight / 2,
              width: crop.inkWidth,
              height: crop.inkHeight,
              confidence: chosen.confidence,
            },
          ]
        : [];
    }
    await worker.setParameters({
      tessedit_char_whitelist: '',
      thresholding_method: '2',
      preserve_interword_spaces: '1',
    });
    // A second recognition model checks weak identifiers and size lines. Only
    // two literal agreeing reads can replace a weak original. No spelling rules,
    // saved-product values or invoice totals participate in recognition.
    const textHeaders = cells.flatMap((cell) => {
      const role = matchStructuralLabel(
        cell.text,
        ['item', 'color', 'description'],
        true,
      )?.role;
      return role ? [{ cell, role }] : [];
    });
    const uncertain = cells
      .flatMap((cell) => {
        const header = textHeaders.find(
          (h) =>
            Math.abs(h.cell.x - cell.x) < 4 &&
            cell.y >= h.cell.y + h.cell.height,
        );
        if (
          !header ||
          (cell.spans.length > 0 &&
            Math.min(...cell.spans.map((s) => s.confidence ?? 100)) >= 80)
        )
          return [];
        if (header.role === 'description') {
          const positioned = groupPositionedSpans(cell.spans);
          return positioned.flatMap((line, index) => {
            const label = findStructuralLabels(line.text, ['size'], true)[0];
            if (!label) return [];
            const next = positioned[index + 1];
            const wrapped =
              !/\d/.test(line.text.slice(label.end)) &&
              next &&
              /\d/.test(next.text) &&
              !findStructuralLabels(next.text, ['backing'], true).length &&
              next.spans[0].y - line.spans[0].y <=
                Math.max(...line.spans.map((s) => s.height)) * 2.5;
            const valueLine = wrapped ? next : line;
            return [
              {
                cell,
                role: header.role,
                spans: valueLine.spans,
                valueOnly: Boolean(wrapped),
                box: {
                  x: cell.x,
                  width: cell.width,
                  y:
                    Math.min(
                      ...valueLine.spans.map((s) => s.y - s.height / 2),
                    ) - 2,
                  height:
                    Math.max(
                      ...valueLine.spans.map((s) => s.y + s.height / 2),
                    ) -
                    Math.min(
                      ...valueLine.spans.map((s) => s.y - s.height / 2),
                    ) +
                    4,
                },
              },
            ];
          });
        }
        // A multi-line/packed color cell must keep its existing row boundaries.
        if (groupPositionedSpans(cell.spans).length > 1) return [];
        return [
          {
            cell,
            role: header.role,
            spans: cell.spans,
            box: cell,
            valueOnly: false,
          },
        ];
      })
      .slice(0, 48);
    if (uncertain.length) {
      try {
        paddle ??= await PaddleLineReader.create();
        for (const target of uncertain) {
          const description = target.role === 'description';
          const crop = cropCellInk(prepared.canvas, target.box, {
            padding: description ? 2 : 16,
          });
          if (!crop) continue;
          try {
            // An empty OCR cell can contain a surviving border instead of a
            // label. Only compact text ink is eligible for identifier recovery.
            if (
              !target.spans.length &&
              crop.inkHeight > target.box.height * 0.7
            )
              continue;
            const first = await paddle.read(crop.canvas.toBuffer('image/png'));
            const alternate = createCanvas(
              crop.canvas.width + (description ? 4 : 8),
              crop.canvas.height + (description ? 0 : 4),
            );
            const ctx = alternate.getContext('2d');
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, alternate.width, alternate.height);
            ctx.drawImage(
              crop.canvas,
              description ? 2 : 4,
              description ? 0 : 2,
            );
            let second;
            try {
              second = await paddle.read(alternate.toBuffer('image/png'));
            } finally {
              alternate.width = 1;
              alternate.height = 1;
            }
            let chosen = confirmedLineReading(first, second, description);
            if (!chosen) {
              const retry = cropCellInk(prepared.canvas, target.box, {
                padding: 8,
              });
              if (retry)
                try {
                  const third = await paddle.read(
                    retry.canvas.toBuffer('image/png'),
                  );
                  chosen =
                    confirmedLineReading(first, third, description) ??
                    confirmedLineReading(second, third, description);
                } finally {
                  retry.canvas.width = 1;
                  retry.canvas.height = 1;
                }
            }
            if (
              !chosen ||
              (target.role === 'color' &&
                !/^[A-Z0-9]+\s*#\s*\S/i.test(chosen.text)) ||
              (target.role === 'description' &&
                (target.valueOnly
                  ? !/^\d.*(?:mm|[x*×])/i.test(chosen.text)
                  : !findStructuralLabels(chosen.text, ['size'], true).length))
            )
              continue;
            const retained = target.cell.spans.filter(
              (span) => !target.spans.includes(span),
            );
            const span = {
              text: chosen.text,
              x: crop.x,
              y: crop.y + crop.inkHeight / 2,
              width: crop.inkWidth,
              height: crop.inkHeight,
              confidence: chosen.confidence,
            };
            target.cell.spans = [...retained, span].sort(
              (a, b) => a.y - b.y || a.x - b.x,
            );
            target.cell.text = groupPositionedSpans(target.cell.spans)
              .map((line) => line.text)
              .join(' ');
          } finally {
            crop.canvas.width = 1;
            crop.canvas.height = 1;
          }
        }
      } catch {
        warnings.push({
          code: 'SECONDARY_OCR_UNAVAILABLE',
          message:
            'Some text could not be checked by the second reader. Review the highlighted fields against your invoice.',
          page,
        });
      }
    }

    if (grid.length) {
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
            const base = page.getViewport({ scale: 1 });
            const nativeViewport = page.getViewport({
              scale: 2400 / base.width,
            });
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
                nativeViewport,
              );
            } catch {
              warnings.push({
                code: 'PDF_TEXT_FAILED',
                message:
                  'Native text could not be read on this page; OCR was used.',
                page: pageNumber,
              });
            }
            let geometry: ReturnType<typeof pdfTableGeometry> | undefined;
            let operators:
              Awaited<ReturnType<typeof page.getOperatorList>> | undefined;
            try {
              operators = await page.getOperatorList();
              geometry = pdfTableGeometry(operators, nativeViewport);
            } catch {
              /* Positioned text remains usable without vector rules. */
            }
            if (
              nativeTextUsable(text.map((line) => line.text).join('\n')) ||
              (!text.length && geometry && !geometry.nonRuleContent)
            ) {
              pages.push({
                page: pageNumber,
                method: 'PDF_TEXT',
                width: nativeViewport.width,
                height: nativeViewport.height,
                rules: geometry?.rules ?? [],
                cells: nativeTableCells(
                  geometry?.rules ?? [],
                  text.flatMap((line) => line.spans ?? []),
                  nativeViewport.width,
                  nativeViewport.height,
                ),
              });
              addLines(text, pageNumber, 'PDF_TEXT');
            } else {
              const originalImage =
                !text.length && operators
                  ? await fullPagePdfImage(
                      page,
                      operators,
                      pdfjs.OPS,
                      options.maxPixels,
                    )
                  : null;
              if (originalImage) {
                await ocr(originalImage, pageNumber);
                continue;
              }
              // 300 DPI target, downscaled only to honor the existing pixel cap.
              const renderScale = Math.min(
                300 / 72,
                Math.sqrt(options.maxPixels / (base.width * base.height)) *
                  0.99,
              );
              const viewport = page.getViewport({ scale: renderScale });
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
    await paddle?.close();
  }
}
