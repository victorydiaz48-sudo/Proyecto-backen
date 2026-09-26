import { imageSize } from 'image-size';
import { ImageValidationError } from './errors.js';

export const ALLOWED_IMAGE_TYPES = ['jpeg', 'png', 'webp'] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

export const IMAGE_MIME: Record<AllowedImageType, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export interface ImageLimits {
  maxBytes: number;
  minDimension: number;
  maxDimension: number;
}

export interface ValidatedImage {
  type: AllowedImageType;
  mime: string;
  width: number;
  height: number;
  bytes: number;
}

/**
 * Identify the format from magic bytes. File names, Telegram mime types and
 * extensions are never trusted.
 */
export function sniffImageType(buf: Uint8Array): AllowedImageType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  )
    return 'png';
  if (
    buf.length >= 12 &&
    String.fromCharCode(buf[0]!, buf[1]!, buf[2]!, buf[3]!) === 'RIFF' &&
    String.fromCharCode(buf[8]!, buf[9]!, buf[10]!, buf[11]!) === 'WEBP'
  )
    return 'webp';
  return null;
}

export function validateImage(buf: Uint8Array, limits: ImageLimits): ValidatedImage {
  if (buf.length === 0) throw new ImageValidationError('corrupt', 'Empty file');
  if (buf.length > limits.maxBytes) {
    throw new ImageValidationError('too_large', `Image is ${buf.length} bytes, limit is ${limits.maxBytes}`);
  }
  const type = sniffImageType(buf);
  if (!type) throw new ImageValidationError('unsupported_type', 'Not a JPEG, PNG or WebP image');

  let width: number | undefined;
  let height: number | undefined;
  try {
    const dims = imageSize(buf);
    width = dims.width;
    height = dims.height;
  } catch {
    throw new ImageValidationError('corrupt', 'Could not read image dimensions');
  }
  if (!width || !height) throw new ImageValidationError('corrupt', 'Could not read image dimensions');
  if (Math.min(width, height) < limits.minDimension) {
    throw new ImageValidationError('too_small', `Image is ${width}x${height}, minimum side is ${limits.minDimension}px`);
  }
  if (Math.max(width, height) > limits.maxDimension) {
    throw new ImageValidationError(
      'too_big_dimensions',
      `Image is ${width}x${height}, maximum side is ${limits.maxDimension}px`,
    );
  }
  return { type, mime: IMAGE_MIME[type], width, height, bytes: buf.length };
}
