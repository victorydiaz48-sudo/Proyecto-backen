import { describe, expect, it } from 'vitest';
import { ImageValidationError } from './errors.js';
import { sniffImageType, validateImage } from './image.js';
import { makePng } from './testing.js';

const limits = { maxBytes: 1024 * 1024, minDimension: 320, maxDimension: 4000 };

function reason(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    if (e instanceof ImageValidationError) return e.reason;
    throw e;
  }
  return 'ok';
}

describe('validateImage', () => {
  it('accepts a valid PNG and reports its real dimensions', () => {
    expect(validateImage(makePng(640, 480), limits)).toMatchObject({ type: 'png', width: 640, height: 480 });
  });

  it('identifies formats by magic bytes, not by name', () => {
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(sniffImageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
    expect(sniffImageType(Buffer.from('%PDF-1.7'))).toBeNull();
  });

  it('rejects non-images, empty, oversized, tiny and huge images', () => {
    expect(reason(() => validateImage(Buffer.from('<html>not an image</html>'), limits))).toBe('unsupported_type');
    expect(reason(() => validateImage(Buffer.alloc(0), limits))).toBe('corrupt');
    expect(reason(() => validateImage(makePng(640, 480), { ...limits, maxBytes: 10 }))).toBe('too_large');
    expect(reason(() => validateImage(makePng(200, 480), limits))).toBe('too_small');
    expect(reason(() => validateImage(makePng(5000, 400), limits))).toBe('too_big_dimensions');
  });

  it('rejects a truncated file that only has a PNG signature', () => {
    expect(reason(() => validateImage(makePng(640, 480).subarray(0, 12), limits))).toBe('corrupt');
  });
});
