import { z } from "zod";

const PASSWORD = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(256)
  .regex(/\d/, "Password must include at least one digit")
  .regex(/[^A-Za-z0-9]/, "Password must include at least one symbol");

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(256),
});

export const twoFactorSetupVerifySchema = z.object({
  setupToken: z.string().min(1),
  totpCode: z.string().regex(/^\d{6}$/, "Must be 6 digits"),
});

export const twoFactorVerifySchema = z
  .object({
    loginChallenge: z.string().min(1),
    totpCode: z.string().regex(/^\d{6}$/).optional(),
    backupCode: z.string().min(8).max(32).optional(),
  })
  .refine((d) => !!d.totpCode || !!d.backupCode, {
    message: "Provide either totpCode or backupCode",
  });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: PASSWORD,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type TwoFactorSetupVerifyInput = z.infer<typeof twoFactorSetupVerifySchema>;
export type TwoFactorVerifyInput = z.infer<typeof twoFactorVerifySchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
