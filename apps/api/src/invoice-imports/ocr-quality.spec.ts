import { numericConsensus } from './ocr-quality.js';
import { preprocessInvoiceImage } from './image-preprocessing.js';
import { imageFixture } from './fixtures/sanitized-invoice.js';
import sharp from 'sharp';

describe('bounded image recovery and independent numeric reads', () => {
  it('retains decimals when independent reads agree', () => {
    expect(
      numericConsensus({ text: '1,263.50', confidence: 72 }, [
        { text: '1263.5', confidence: 91 },
        { text: '1263.50', confidence: 89 },
      ]),
    ).toEqual({ text: '1,263.50', confidence: 89, conflict: false });
  });
  it('requires two confident reads to repair a malformed number', () => {
    expect(
      numericConsensus({ text: '12O3.5', confidence: 43 }, [
        { text: '1203.5', confidence: 94 },
        { text: '1203.50', confidence: 88 },
      ]),
    ).toMatchObject({ text: '1203.5', confidence: 88, conflict: false });
    expect(
      numericConsensus({ text: '12O3.5', confidence: 43 }, [
        { text: '1203.5', confidence: 94 },
      ]),
    ).toMatchObject({ text: '12O3.5', confidence: 43 });
  });
  it('blocks conflicting valid numbers rather than choosing a majority or expected total', () => {
    expect(
      numericConsensus({ text: '1095', confidence: 72 }, [
        { text: '109.5', confidence: 94 },
        { text: '109.5', confidence: 93 },
      ]),
    ).toEqual({ text: '1095', confidence: 49, conflict: true });
  });
  it('does not recover punctuation or unsupported precision by guessing', () => {
    const original = { text: '12O3', confidence: 30 };
    expect(
      numericConsensus(original, [
        { text: '1,20.3', confidence: 90 },
        { text: '120.333', confidence: 90 },
      ]),
    ).toMatchObject(original);
  });
  it('corrects camera EXIF orientation without changing the original file', async () => {
    const upright = imageFixture([
      'Commercial Invoice',
      'Contract No.: TEST2614',
    ]);
    const rotated = await sharp(upright)
      .rotate(90)
      .withMetadata({ orientation: 8 })
      .jpeg()
      .toBuffer();
    const original = Buffer.from(rotated);
    const prepared = await preprocessInvoiceImage(rotated, 16000000);
    expect(prepared.width).toBeGreaterThan(prepared.height);
    expect(prepared.width * prepared.height).toBeLessThanOrEqual(16000000);
    expect(rotated.equals(original)).toBe(true);
    prepared.canvas.width = 1;
    prepared.canvas.height = 1;
  });
});
