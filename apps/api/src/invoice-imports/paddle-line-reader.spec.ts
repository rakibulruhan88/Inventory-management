import PDFDocument from 'pdfkit';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PaddleLineReader, decodeCtc } from './paddle-line-reader.js';
import { cropCellInk } from './ocr-cell.js';
import { confirmedLineReading, numericCellConsensus } from './ocr-quality.js';

async function serifLines() {
  const values = [
    'F07124#Beige',
    '716#L-Green',
    '835#L-Brown',
    '904#Off white',
    'Size: 1.1mm*54"*36.5m',
    '1',
    '42',
  ];
  const doc = new PDFDocument({ size: [500, 420], margin: 0 });
  const chunks: Buffer[] = [];
  const bytes = new Promise<Buffer>((resolve) => {
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });
  values.forEach((value, i) =>
    doc
      .font('Times-Roman')
      .fontSize(16)
      .text(value, 30, 20 + i * 52, { lineBreak: false }),
  );
  doc.end();
  const require = createRequire(import.meta.url);
  const task = getDocument({
    data: new Uint8Array(await bytes),
    useSystemFonts: false,
    standardFontDataUrl:
      join(
        dirname(require.resolve('pdfjs-dist/package.json')),
        'standard_fonts',
      ) + '/',
  });
  try {
    const pdf = await task.promise,
      page = await pdf.getPage(1),
      viewport = page.getViewport({ scale: 2 });
    const canvas = createCanvas(viewport.width, viewport.height);
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: canvas.getContext(
        '2d',
      ) as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    return { canvas, values };
  } finally {
    await task.destroy();
  }
}

describe('independent local Paddle line recognition', () => {
  it('reads serif identifiers, punctuation, a single Roll and multi-digit stock literally', async () => {
    const { canvas, values } = await serifLines();
    const reader = await PaddleLineReader.create();
    try {
      for (let i = 0; i < values.length; i++) {
        const crop = cropCellInk(canvas, {
          x: 40,
          y: 35 + i * 104,
          width: 850,
          height: 65,
        })!;
        try {
          const result = await reader.read(crop.canvas.toBuffer('image/png'));
          expect(result.text.replace(/\s/g, '')).toBe(
            values[i].replace(/\s/g, ''),
          );
          expect(result.confidence).toBeGreaterThan(95);
        } finally {
          crop.canvas.width = 1;
          crop.canvas.height = 1;
        }
      }
    } finally {
      await reader.close();
      canvas.width = 1;
      canvas.height = 1;
    }
  }, 30_000);
  it('decodes blank tokens without deleting real repeated digits', () => {
    const dictionary = ['', 'F', '0', '7', '1'];
    const sequence = [1, 1, 0, 2, 0, 3, 0, 4, 0, 4];
    const data = new Float32Array(sequence.length * dictionary.length);
    sequence.forEach((c, i) => (data[i * dictionary.length + c] = 0.99));
    expect(
      decodeCtc(data, sequence.length, dictionary.length, dictionary).text,
    ).toBe('F0711');
  });
  it('requires literal agreement and strong character confidence', () => {
    const good = {
      text: 'F07124#Beige',
      confidence: 99,
      minimumConfidence: 97,
    };
    expect(
      confirmedLineReading(good, { ...good, text: 'FO7124#Beige' }),
    ).toBeNull();
    expect(
      confirmedLineReading(good, { ...good, minimumConfidence: 40 }),
    ).toBeNull();
    expect(confirmedLineReading(good, { ...good, confidence: 90 })).toBeNull();
    expect(confirmedLineReading(good, good)?.text).toBe(good.text);
  });
  it('recovers dropped digits and empty stock cells with two strong specialized reads', () => {
    const fortyTwo = { text: '42', confidence: 96 };
    expect(
      numericCellConsensus({ text: '4', confidence: 85 }, [fortyTwo, fortyTwo])
        .text,
    ).toBe('42');
    expect(
      numericCellConsensus({ text: '4', confidence: 96 }, [fortyTwo, fortyTwo])
        .conflict,
    ).toBe(true);
    expect(
      numericCellConsensus({ text: '', confidence: 0 }, [
        { text: '1', confidence: 96 },
        { text: '1', confidence: 96 },
      ]).text,
    ).toBe('1');
    expect(
      numericCellConsensus({ text: '4', confidence: 85 }, [fortyTwo]).conflict,
    ).toBe(true);
  });
  it('crops all ink independently of incomplete OCR boxes and ignores empty cells', () => {
    const canvas = createCanvas(200, 80),
      ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 200, 80);
    expect(
      cropCellInk(canvas, { x: 0, y: 0, width: 200, height: 80 }),
    ).toBeNull();
    ctx.fillStyle = 'black';
    ctx.fillRect(80, 15, 4, 25);
    const crop = cropCellInk(canvas, { x: 0, y: 0, width: 200, height: 80 })!;
    expect(crop.inkWidth).toBe(4);
    expect(crop.scale).toBe(1);
    crop.canvas.width = 1;
    canvas.width = 1;
  });
});
