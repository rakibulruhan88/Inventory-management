import { createCanvas } from '@napi-rs/canvas';
import type { PDFPageProxy } from 'pdfjs-dist';

type Matrix = [number, number, number, number, number, number];
type Bitmap = {
  width: number;
  height: number;
  data?: Uint8ClampedArray | Uint8Array;
};
const multiply = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];

// An image-only PDF is often just a phone photo wrapped in a page. Read its
// decoded pixels directly instead of blurring thin rules through a second
// page rasterization. Mixed, clipped, rotated or overlaid pages still render.
export async function fullPagePdfImage(
  page: PDFPageProxy,
  operators: Awaited<ReturnType<PDFPageProxy['getOperatorList']>>,
  ops: Record<string, number> | undefined,
  maxPixels: number,
): Promise<Buffer | null> {
  if (!ops || page.rotate) return null;
  let matrix: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  let image: Bitmap | undefined, imageMatrix: Matrix | undefined;
  for (let i = 0; i < operators.fnArray.length; i++) {
    const op = operators.fnArray[i],
      args = operators.argsArray[i];
    if (op === ops.save) stack.push([...matrix]);
    else if (op === ops.restore) {
      const previous = stack.pop();
      if (!previous) return null;
      matrix = previous;
    } else if (op === ops.transform) {
      if (args?.length !== 6 || !args.every(Number.isFinite)) return null;
      matrix = multiply(matrix, args as Matrix);
    } else if (op === ops.dependency) continue;
    else if (
      op === ops.paintImageXObject ||
      op === ops.paintInlineImageXObject
    ) {
      if (image) return null;
      image =
        op === ops.paintImageXObject
          ? await new Promise<Bitmap>((resolve) =>
              page.objs.get(args[0], resolve),
            )
          : (args[0] as Bitmap);
      imageMatrix = [...matrix];
    } else return null;
  }
  if (!image?.data || !imageMatrix || stack.length) return null;
  const [sx, skewY, skewX, sy, x, y] = imageMatrix;
  const [left, bottom, right, top] = page.view;
  if (
    sx <= 0 ||
    sy <= 0 ||
    Math.abs(skewX) > 0.001 ||
    Math.abs(skewY) > 0.001 ||
    sx < (right - left) * 0.8 ||
    sy < (top - bottom) * 0.8 ||
    x < left - 1 ||
    y < bottom - 1 ||
    x + sx > right + 1 ||
    y + sy > top + 1
  )
    return null;
  const count = image.width * image.height;
  if (!Number.isSafeInteger(count) || count < 1 || count > maxPixels)
    return null;
  const channels = image.data.length / count;
  if (channels !== 3 && channels !== 4) return null;
  const canvas = createCanvas(image.width, image.height),
    ctx = canvas.getContext('2d');
  try {
    const pixels = ctx.createImageData(image.width, image.height);
    for (let p = 0; p < count; p++) {
      pixels.data[p * 4] = image.data[p * channels];
      pixels.data[p * 4 + 1] = image.data[p * channels + 1];
      pixels.data[p * 4 + 2] = image.data[p * channels + 2];
      pixels.data[p * 4 + 3] =
        channels === 4 ? image.data[p * channels + 3] : 255;
    }
    ctx.putImageData(pixels, 0, 0);
    return canvas.toBuffer('image/png');
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}
