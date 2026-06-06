import { generateSecret, generateURI, verify, NobleCryptoPlugin, ScureBase32Plugin } from "otplib";
import QRCode from "qrcode";
import { env } from "../config/env.js";

// otplib v13 requires explicit crypto + base32 plugins on every verify call.
// Pin them once here so the integration is consistent.
const CRYPTO = new NobleCryptoPlugin();
const BASE32 = new ScureBase32Plugin();

// 30-second window (default) with ±30s drift tolerance — handles ~1 minute of
// clock skew between the user's phone and our server.
const PERIOD_S = 30;
const TOLERANCE_S = 30;

export const totp = {
  generateSecret(): string {
    return generateSecret();
  },

  /**
   * Build the otpauth:// URL that authenticator apps consume via QR scan.
   * Label format: "Ahia Admin:email@example.com" — most apps render this
   * nicely; "issuer" lets users keep multiple Ahia entries straight.
   */
  buildOtpAuthUrl(email: string, secret: string): string {
    return generateURI({
      strategy: "totp",
      issuer: env.ADMIN_TOTP_ISSUER,
      label: email,
      secret,
    });
  },

  async qrDataUrl(otpauthUrl: string): Promise<string> {
    return QRCode.toDataURL(otpauthUrl, { width: 240, margin: 1 });
  },

  async verify(token: string, secret: string): Promise<boolean> {
    if (!/^\d{6}$/.test(token)) return false;
    try {
      const result = await verify({
        token,
        secret,
        crypto: CRYPTO,
        base32: BASE32,
        period: PERIOD_S,
        epochTolerance: TOLERANCE_S,
      });
      return result.valid === true;
    } catch {
      return false;
    }
  },
};
