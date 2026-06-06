import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env.js";
import { InternalError } from "../errors.js";
import { logger } from "../config/logger.js";

const isConfigured = !!(
  env.CLOUDINARY_CLOUD_NAME &&
  env.CLOUDINARY_API_KEY &&
  env.CLOUDINARY_API_SECRET
);

if (isConfigured) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
} else {
  logger.warn("cloudinary: not configured — upload endpoints will fail until env is set");
}

export function isCloudinaryConfigured() {
  return isConfigured;
}

type UploadOptions = {
  folder: string;
  publicId?: string;
};

export function uploadImageBuffer(buffer: Buffer, opts: UploadOptions): Promise<string> {
  if (!isConfigured) throw new InternalError("Cloudinary not configured");
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: opts.folder,
        public_id: opts.publicId,
        resource_type: "image",
        overwrite: !!opts.publicId,
      },
      (err, result) => {
        if (err || !result?.secure_url) {
          reject(err ?? new InternalError("Cloudinary upload returned no URL"));
        } else {
          resolve(result.secure_url);
        }
      },
    );
    stream.end(buffer);
  });
}

export type UploadResult = { url: string; publicId: string; posterUrl?: string };

export function uploadImageBufferWithId(
  buffer: Buffer,
  opts: UploadOptions,
): Promise<{ url: string; publicId: string }> {
  if (!isConfigured) throw new InternalError("Cloudinary not configured");
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: opts.folder,
        public_id: opts.publicId,
        resource_type: "image",
        overwrite: !!opts.publicId,
      },
      (err, result) => {
        if (err || !result?.secure_url || !result?.public_id) {
          reject(err ?? new InternalError("Cloudinary image upload returned no URL"));
        } else {
          resolve({ url: result.secure_url, publicId: result.public_id });
        }
      },
    );
    stream.end(buffer);
  });
}

export function uploadStoryImageBuffer(
  buffer: Buffer,
  opts: UploadOptions,
): Promise<UploadResult> {
  if (!isConfigured) throw new InternalError("Cloudinary not configured");
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: opts.folder,
        public_id: opts.publicId,
        resource_type: "image",
        overwrite: !!opts.publicId,
      },
      (err, result) => {
        if (err || !result?.secure_url || !result?.public_id) {
          reject(err ?? new InternalError("Cloudinary story image upload returned no URL"));
        } else {
          resolve({ url: result.secure_url, publicId: result.public_id });
        }
      },
    );
    stream.end(buffer);
  });
}

export function uploadStoryVideoBuffer(
  buffer: Buffer,
  opts: UploadOptions,
): Promise<UploadResult> {
  if (!isConfigured) throw new InternalError("Cloudinary not configured");
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: opts.folder,
        public_id: opts.publicId,
        resource_type: "video",
        overwrite: !!opts.publicId,
      },
      (err, result) => {
        if (err || !result?.secure_url || !result?.public_id) {
          reject(err ?? new InternalError("Cloudinary story video upload returned no URL"));
          return;
        }
        const posterUrl = cloudinary.url(result.public_id, {
          resource_type: "video",
          format: "jpg",
          secure: true,
        });
        resolve({ url: result.secure_url, publicId: result.public_id, posterUrl });
      },
    );
    stream.end(buffer);
  });
}

export async function destroyFolder(folderPrefix: string): Promise<void> {
  if (!isConfigured) {
    logger.warn("cloudinary: destroyFolder skipped — not configured", { folderPrefix });
    return;
  }
  try {
    await cloudinary.api.delete_resources_by_prefix(folderPrefix, { resource_type: "image" });
    await cloudinary.api.delete_resources_by_prefix(folderPrefix, { resource_type: "video" });
    await cloudinary.api.delete_folder(folderPrefix).catch(() => undefined);
  } catch (err) {
    logger.error("cloudinary: destroyFolder failed", {
      folderPrefix,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function destroyAsset(
  publicId: string,
  resourceType: "image" | "video",
): Promise<void> {
  if (!isConfigured) {
    logger.warn("cloudinary: destroyAsset skipped — not configured", { publicId });
    return;
  }
  // Retry with exponential backoff so transient Cloudinary blips don't
  // leave orphan assets. Three attempts with 1s, 2s, 4s waits.
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await cloudinary.uploader.destroy(publicId, {
        resource_type: resourceType,
        invalidate: true,
      });
      return;
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) {
        logger.error("cloudinary: destroyAsset failed (final attempt)", {
          publicId,
          attempt,
          message: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      const backoffMs = Math.pow(2, attempt - 1) * 1000;
      logger.warn("cloudinary: destroyAsset attempt failed, retrying", {
        publicId,
        attempt,
        backoffMs,
        message: err instanceof Error ? err.message : String(err),
      });
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
}

export function uploadVoiceBuffer(buffer: Buffer, opts: UploadOptions): Promise<string> {
  if (!isConfigured) throw new InternalError("Cloudinary not configured");
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: opts.folder,
        public_id: opts.publicId,
        resource_type: "video", // Cloudinary treats audio as video resource type
        overwrite: !!opts.publicId,
      },
      (err, result) => {
        if (err || !result?.secure_url) {
          reject(err ?? new InternalError("Cloudinary voice upload returned no URL"));
        } else {
          resolve(result.secure_url);
        }
      },
    );
    stream.end(buffer);
  });
}

export function uploadVideoBuffer(
  buffer: Buffer,
  opts: UploadOptions,
): Promise<{ videoUrl: string; posterUrl: string }> {
  if (!isConfigured) throw new InternalError("Cloudinary not configured");
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: opts.folder,
        public_id: opts.publicId,
        resource_type: "video",
        overwrite: !!opts.publicId,
      },
      (err, result) => {
        if (err || !result?.secure_url || !result?.public_id) {
          reject(err ?? new InternalError("Cloudinary video upload returned no URL"));
          return;
        }
        const posterUrl = cloudinary.url(result.public_id, {
          resource_type: "video",
          format: "jpg",
          secure: true,
        });
        resolve({ videoUrl: result.secure_url, posterUrl });
      },
    );
    stream.end(buffer);
  });
}

export async function uploadImageFromUrl(url: string, opts: UploadOptions): Promise<string> {
  if (!isConfigured) throw new InternalError("Cloudinary not configured");
  if (env.CLOUDINARY_CLOUD_NAME && url.includes(`/${env.CLOUDINARY_CLOUD_NAME}/`)) {
    return url;
  }
  const result = await cloudinary.uploader.upload(url, {
    folder: opts.folder,
    public_id: opts.publicId,
    resource_type: "image",
    overwrite: !!opts.publicId,
  });
  return result.secure_url;
}

export { cloudinary };
