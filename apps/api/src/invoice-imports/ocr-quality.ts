export type NumericReading = { text: string; confidence: number };
const numberPattern = /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/;
const value = (reading: NumericReading) =>
  numberPattern.test(reading.text.trim())
    ? Number(reading.text.trim().replaceAll(',', ''))
    : null;

// A credible valid conflicting read requires a human. Expected totals, previous
// imports and supplier-specific values are deliberately absent from voting.
export function numericConsensus(
  original: NumericReading,
  retries: NumericReading[],
) {
  const candidates = [original, ...retries].filter(
    (reading) => value(reading) !== null && reading.confidence >= 60,
  );
  const distinct = new Set(candidates.map(value));
  if (distinct.size > 1)
    return {
      ...original,
      confidence: Math.min(original.confidence, 49),
      conflict: true,
    };
  const agreeing = candidates.filter((reading) => reading.confidence >= 80);
  if (agreeing.length >= 2) {
    const selected =
      value(original) === value(agreeing[0]) ? original : agreeing[0];
    return {
      text: selected.text,
      confidence: Math.min(...agreeing.map((reading) => reading.confidence)),
      conflict: false,
    };
  }
  return { ...original, conflict: false };
}

// Two agreeing field-specific reads may recover a dropped digit in a weak
// generic block read. A high-confidence conflicting generic value still blocks.
export function numericCellConsensus(
  original: NumericReading,
  retries: NumericReading[],
) {
  const precise = retries.filter(
    (r) => value(r) !== null && r.confidence >= 80,
  );
  if (
    precise.length >= 2 &&
    new Set(precise.map(value)).size === 1 &&
    original.confidence < 90
  )
    return numericConsensus(precise[0], precise.slice(1));
  return numericConsensus(original, retries);
}

export function confirmedLineReading(
  first: {
    text: string;
    confidence: number;
    minimumConfidence: number;
    minimumContentConfidence?: number;
  },
  second: {
    text: string;
    confidence: number;
    minimumConfidence: number;
    minimumContentConfidence?: number;
  },
  description = false,
) {
  const literal = (text: string) =>
    description
      ? text
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/^size\s*:\s*/i, 'Size:')
      : text.replace(/\s+/g, ' ').trim();
  const text = literal(first.text);
  if (
    !text ||
    text !== literal(second.text) ||
    Math.min(first.confidence, second.confidence) < 95 ||
    (description
      ? Math.min(
          first.minimumContentConfidence ?? first.minimumConfidence,
          second.minimumContentConfidence ?? second.minimumConfidence,
        ) < 95
      : Math.min(first.minimumConfidence, second.minimumConfidence) < 80)
  )
    return null;
  return { text, confidence: Math.min(first.confidence, second.confidence) };
}
