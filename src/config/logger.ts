import winston from "winston";
import { env } from "./env.js";

const { combine, timestamp, errors, json, colorize, printf, splat } = winston.format;

const isProd = env.NODE_ENV === "production";

const devFormat = combine(
  colorize({ level: true }),
  timestamp({ format: "HH:mm:ss" }),
  errors({ stack: true }),
  splat(),
  printf(({ timestamp: ts, level, message, stack, ...meta }) => {
    const metaKeys = Object.keys(meta);
    const metaStr = metaKeys.length ? ` ${JSON.stringify(meta)}` : "";
    return stack
      ? `${ts} ${level} ${message}${metaStr}\n${stack}`
      : `${ts} ${level} ${message}${metaStr}`;
  }),
);

const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  splat(),
  json(),
);

export const logger = winston.createLogger({
  level: isProd ? "info" : "debug",
  format: isProd ? prodFormat : devFormat,
  transports: [new winston.transports.Console()],
  exitOnError: false,
});
