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
