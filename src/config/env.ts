import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_URL: z
    .string()
    .min(1)
    .transform((v, ctx) => {
      const urls = v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (urls.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "At least one URL required",
        });
        return z.NEVER;
      }
      for (const u of urls) {
        try {
          new URL(u);
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Invalid URL: ${u}`,
          });
          return z.NEVER;
        }
      }
      return urls;
    }),

  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),

  JWT_SECRET: z.string().min(32),
  COOKIE_DOMAIN: z.string().optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),

  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_TEAM_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  APPLE_PRIVATE_KEY: z.string().optional(),
  APPLE_REDIRECT_URI: z.string().url().optional(),

  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  PAYSTACK_SECRET_KEY: z.string().optional(),

  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().email().optional(),

  // Admin app — Phase 1
  ADMIN_COOKIE_NAME: z.string().default("ahia_admin_session"),
  ADMIN_COOKIE_SECRET: z.string().min(32).optional(),
  ADMIN_BOOTSTRAP_EMAIL: z.string().email().optional(),
  // Temporary first-boot password — relaxed to min 6 so an operator can use
  // a short throwaway string. The strict policy (12 chars + digit + symbol)
  // applies the moment they change it via POST /admin/auth/change-password.
  ADMIN_BOOTSTRAP_PASSWORD: z.string().min(6).optional(),
  ADMIN_TOTP_ISSUER: z.string().default("Ahia Admin"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
