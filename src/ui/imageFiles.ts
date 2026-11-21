/**
 * Browser-only image intake: validate, downscale and inline as a data URL.
 * Images live inside the project document so they travel with backups; keeping
 * them small is what makes that affordable.
 */

import { createId } from '../core/id';
import { MAX_IMAGE_DATA_URL_LENGTH } from '../core/types';
import type { NodeImage } from '../core/types';

/** Longest edge after downscaling. */
const MAX_EDGE = 1400;
/** Source files above this are refused before any decoding work. */
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
/** Animated GIFs are kept as-is when they are already small enough. */
const MAX_PASSTHROUGH_BYTES = 1_200_000;

export interface ImageIntakeResult {
  images: NodeImage[];
  /** Human-readable reasons files were skipped. */
  skipped: string[];
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

async function processFile(file: File): Promise<NodeImage | string> {
  if (!file.type.startsWith('image/')) {
    return `${file.name} is not an image`;
  }
  if (file.size > MAX_SOURCE_BYTES) {
    return `${file.name} is larger than ${formatSize(MAX_SOURCE_BYTES)}`;
  }

  // Keep animated GIFs intact rather than flattening them to a still frame.
  if (file.type === 'image/gif' && file.size <= MAX_PASSTHROUGH_BYTES) {
    const dataUrl = await readAsDataUrl(file);
    return {
      id: createId('img'),
      name: file.name,
      dataUrl,
      width: 0,
      height: 0,
      addedAt: new Date().toISOString(),
    };
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    return `${file.name} could not be processed`;
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  let dataUrl = canvas.toDataURL('image/webp', 0.85);
  if (!dataUrl.startsWith('data:image/webp')) {
    // Browsers without WebP encoding fall back to PNG.
    dataUrl = canvas.toDataURL('image/png');
  }
  if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
    dataUrl = canvas.toDataURL('image/jpeg', 0.7);
  }
  if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
    return `${file.name} is too detailed to store locally`;
  }

  return {
    id: createId('img'),
    name: file.name,
    dataUrl,
    width,
    height,
    addedAt: new Date().toISOString(),
  };
}

/** Reads a batch of dropped or selected files into storable node images. */
export async function filesToNodeImages(files: File[]): Promise<ImageIntakeResult> {
  const images: NodeImage[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    try {
      const result = await processFile(file);
      if (typeof result === 'string') skipped.push(result);
      else images.push(result);
    } catch {
      skipped.push(`${file.name} could not be read`);
    }
  }

  return { images, skipped };
}
