import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { InferenceSession, Tensor } from 'onnxruntime-node';
import sharp from 'sharp';

export type LineReading = {
  text: string;
  confidence: number;
  minimumConfidence: number;
  minimumContentConfidence: number;
};
const require = createRequire(import.meta.url);

// PP-OCRv4 recognition only. Existing physical cells own every crop; there is
// no second detector guessing table ownership, and no generative text model.
export class PaddleLineReader {
  private constructor(
    private session: InferenceSession,
    private dictionary: string[],
  ) {}
  static async create() {
    const root = join(
      dirname(require.resolve('@gutenye/ocr-models/node')),
      'assets',
    );
    const dictionary = [
      '',
      ...(await readFile(join(root, 'ppocr_keys_v1.txt'), 'utf8'))
        .replace(/\r/g, '')
        .split('\n'),
      ' ',
    ];
    const session = await InferenceSession.create(
      join(root, 'ch_PP-OCRv4_rec_infer.onnx'),
      {
        executionProviders: ['cpu'],
        executionMode: 'sequential',
        intraOpNumThreads: 1,
        interOpNumThreads: 1,
      },
    );
    return new PaddleLineReader(session, dictionary);
  }
  async read(bytes: Buffer): Promise<LineReading> {
    const image = sharp(bytes, { limitInputPixels: 16000000 })
      .flatten({ background: 'white' })
      .removeAlpha()
      .toColourspace('srgb');
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height)
      throw new Error('Invalid OCR line');
    const width = Math.min(
      2048,
      Math.max(8, Math.round((metadata.width / metadata.height) * 48)),
    );
    const { data, info } = await image
      .resize(width, 48, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const plane = info.width * info.height,
      values = new Float32Array(plane * 3);
    // Pack BGR planar channels in [0,1], matching the packaged v4 graph.
    for (let pixel = 0; pixel < plane; pixel++)
      for (let channel = 0; channel < 3; channel++)
        values[channel * plane + pixel] =
          data[pixel * info.channels + 2 - channel] / 255;
    const input = new Tensor('float32', values, [1, 3, 48, width]);
    const outputs = await this.session.run({
      [this.session.inputNames[0]]: input,
    });
    try {
      const output = outputs[this.session.outputNames[0]];
      if (
        output.dims.length !== 3 ||
        output.dims[0] !== 1 ||
        output.dims[2] !== this.dictionary.length
      )
        throw new Error('Unexpected OCR model output');
      return decodeCtc(
        output.data as Float32Array,
        output.dims[1],
        output.dims[2],
        this.dictionary,
      );
    } finally {
      input.dispose();
      for (const tensor of Object.values(outputs)) tensor.dispose();
    }
  }
  async close() {
    await this.session.release();
  }
}

export function decodeCtc(
  data: Float32Array,
  steps: number,
  classes: number,
  dictionary: string[],
): LineReading {
  let previous = 0,
    text = '';
  const confidence: number[] = [];
  const contentConfidence: number[] = [];
  if (
    data.length !== steps * classes ||
    classes !== dictionary.length ||
    steps > 10000
  )
    throw new Error('Invalid OCR probabilities');
  for (let step = 0; step < steps; step++) {
    let index = 0,
      score = -Infinity;
    for (let c = 0; c < classes; c++) {
      const p = data[step * classes + c];
      if (p > score) {
        score = p;
        index = c;
      }
    }
    if (index && index !== previous) {
      text += dictionary[index];
      confidence.push(score * 100);
      if (/[\p{L}\p{N}]/u.test(dictionary[index]))
        contentConfidence.push(score * 100);
    }
    previous = index;
  }
  return {
    text: text.trim(),
    confidence: confidence.length
      ? confidence.reduce((a, b) => a + b, 0) / confidence.length
      : 0,
    minimumConfidence: confidence.length ? Math.min(...confidence) : 0,
    minimumContentConfidence: contentConfidence.length
      ? Math.min(...contentConfidence)
      : 0,
  };
}
