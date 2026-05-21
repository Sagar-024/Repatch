import { z } from "zod";

export const ConfigSchema = z.object({
  model: z.string().default("gemini-3.1-flash-lite"),
  openai: z.object({
    apiKey: z.string().optional(),
    baseUrl: z.string().default("https://api.openai.com/v1"),
  }).default({
    baseUrl: "https://api.openai.com/v1"
  }),
  anthropic: z.object({
    apiKey: z.string().optional(),
  }).default({}),
  gemini: z.object({
    apiKey: z.string().optional(),
  }).default({}),
  mimo: z.object({
    apiKey: z.string().optional(),
    baseUrl: z.string().default("https://opengateway.gitlawb.com/v1"),
  }).default({
    baseUrl: "https://opengateway.gitlawb.com/v1"
  }),
  github: z.object({
    token: z.string().optional(),
  }).default({}),
  sandbox: z.object({
    memory: z.string().default("2g"),
    cpus: z.number().default(1),
    network: z.boolean().default(false),
  }).default({
    memory: "2g",
    cpus: 1,
    network: false,
  }),
  logging: z.object({
    level: z.enum(["debug", "info", "warn", "error"]).default("info"),
  }).default({
    level: "info",
  }),
});

export type Config = z.infer<typeof ConfigSchema>;
