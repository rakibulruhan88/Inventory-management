import type { PDFPageProxy } from 'pdfjs-dist';
import { loadImage } from '@napi-rs/canvas';
import { fullPagePdfImage } from './pdf-image.js';

const ops = {
  save: 1,
  restore: 2,
  transform: 3,
  dependency: 4,
  paintImageXObject: 5,
  paintInlineImageXObject: 6,
};
function fixture(matrix = [100, 0, 0, 100, 0, 0]) {
  const data = new Uint8Array(10 * 10 * 3).fill(255);
  data[0] = 0;
  const image = { width: 10, height: 10, data };
  const page = {
    rotate: 0,
    view: [0, 0, 100, 100],
    objs: {
      get: (_id: string, ready: (v: typeof image) => void) => ready(image),
    },
  } as unknown as PDFPageProxy;
  const operators = {
    fnArray: [ops.save, ops.transform, ops.paintImageXObject, ops.restore],
    argsArray: [null, matrix, ['image'], null],
    lastChunk: true,
    separateAnnots: null,
  };
  return { page, operators, image };
}
describe('original image pixels in image-only PDFs', () => {
  it('keeps the original bitmap resolution instead of resampling the PDF page', async () => {
    const { page, operators } = fixture();
    const bytes = await fullPagePdfImage(page, operators, ops, 16000000);
    expect(bytes).not.toBeNull();
    const decoded = await loadImage(bytes!);
    expect([decoded.width, decoded.height]).toEqual([10, 10]);
  });
  it.each([
    [120, 0, 0, 100, 0, 0],
    [20, 0, 0, 20, 0, 0],
    [-100, 0, 0, 100, 100, 0],
    [100, 2, 0, 100, 0, 0],
  ])(
    'renders clipped, small, mirrored or skewed images normally: %j',
    async (...matrix) => {
      const { page, operators } = fixture(matrix);
      expect(await fullPagePdfImage(page, operators, ops, 16000000)).toBeNull();
    },
  );
  it('does not discard overlays, extra images or page rotation', async () => {
    for (const extra of [ops.paintImageXObject, 999]) {
      const { page, operators } = fixture();
      operators.fnArray.splice(3, 0, extra);
      operators.argsArray.splice(3, 0, ['image']);
      expect(await fullPagePdfImage(page, operators, ops, 16000000)).toBeNull();
    }
    const { page, operators } = fixture();
    Object.defineProperty(page, 'rotate', { value: 90 });
    expect(await fullPagePdfImage(page, operators, ops, 16000000)).toBeNull();
  });
  it('enforces the pixel cap before allocating an output canvas', async () => {
    const { page, operators, image } = fixture();
    image.width = 10000;
    image.height = 10000;
    expect(await fullPagePdfImage(page, operators, ops, 16000000)).toBeNull();
  });
});
