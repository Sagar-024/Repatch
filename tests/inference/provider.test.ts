import { describe, it, expect, vi, beforeEach } from "vitest";
import { createProvider, GeminiCLIProvider, OpenAIProvider, AnthropicProvider, GeminiAPIProvider, MimoProvider } from "../../src/inference/provider.js";
import { execa } from "execa";
import https from "https";

vi.mock("https", () => {
  return {
    default: {
      request: vi.fn((options: any, callback: any) => {
        const req: any = {
          write: vi.fn(),
          end: vi.fn(() => {
            const res: any = {
              statusCode: 200,
              on: vi.fn((event, cb) => {
                if (event === "data") {
                  cb(Buffer.from(JSON.stringify({
                    choices: [
                      {
                        message: {
                          content: "Hello from Mimo!",
                          tool_calls: [
                            {
                              id: "call_123",
                              type: "function",
                              function: {
                                name: "grep_search",
                                arguments: '{"query": "MimoProvider"}'
                              }
                            }
                          ]
                        }
                      }
                    ]
                  })));
                }
                if (event === "end") {
                  cb();
                }
              })
            };
            callback(res);
          }),
          on: vi.fn()
        };
        return req;
      })
    }
  };
});

vi.mock("execa", () => ({
  execa: vi.fn()
}));

// Mock GoogleGenerativeAI SDK as a plain class to survive vi.resetAllMocks()
vi.mock("@google/generative-ai", () => {
  return {
    GoogleGenerativeAI: class {
      apiKey: string;
      constructor(apiKey: string) {
        this.apiKey = apiKey;
      }
      getGenerativeModel(cfg: any) {
        return {
          generateContent: async () => {
            return {
              response: {
                candidates: [
                  {
                    content: {
                      parts: [
                        { text: "Hello from Gemini API!" },
                        {
                          functionCall: {
                            name: "edit_file",
                            args: { filePath: "src/index.ts" }
                          }
                        }
                      ]
                    }
                  }
                ]
              }
            };
          }
        };
      }
    }
  };
});

vi.mock("../config/loader.js", () => ({
  config: {
    model: "gemini-test",
    openai: { apiKey: "test-key" },
    anthropic: { apiKey: "test-key" }
  }
}));

describe("inference/provider", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("createProvider", () => {
    it("creates Gemini CLI provider by default if no API key is specified", () => {
      const provider = createProvider({ model: "gemini-1.5-pro" });
      expect(provider).toBeInstanceOf(GeminiCLIProvider);
    });

    it("creates Gemini API provider if apiKey is supplied", () => {
      const provider = createProvider({ model: "gemini-1.5-pro", apiKey: "test-key-gemini" });
      expect(provider).toBeInstanceOf(GeminiAPIProvider);
    });

    it("creates Anthropic provider for claude models", () => {
      const provider = createProvider({ model: "claude-3-opus" });
      expect(provider).toBeInstanceOf(AnthropicProvider);
    });

    it("creates OpenAI provider for gpt models", () => {
      const provider = createProvider({ model: "gpt-4" });
      expect(provider).toBeInstanceOf(OpenAIProvider);
    });

    it("creates Mimo provider for mimo models", () => {
      const provider = createProvider({ model: "mimo-v2.5-pro" });
      expect(provider).toBeInstanceOf(MimoProvider);
    });
  });

  describe("GeminiCLIProvider", () => {
    it("calls gemini CLI and parses output", async () => {
      (execa as any).mockResolvedValue({
        stdout: JSON.stringify({
          response: 'Hello! { "name": "edit_file", "arguments": { "filePath": "test.ts" } }'
        })
      });

      const provider = new GeminiCLIProvider({ model: "gemini-test" });
      const response = await provider.complete([{ role: "user", content: "test" }]);

      expect(response.content).toContain("Hello!");
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0].name).toBe("edit_file");
      expect(execa).toHaveBeenCalledWith("gemini", expect.arrayContaining(["-p"]), expect.any(Object));
    });
  });

  describe("GeminiAPIProvider", () => {
    it("calls Gemini API and parses content & function calls", async () => {
      const provider = new GeminiAPIProvider({ model: "gemini-1.5-pro", apiKey: "test-gemini-key" });
      const response = await provider.complete([{ role: "user", content: "hello" }]);

      expect(response.content).toBe("Hello from Gemini API!");
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0].name).toBe("edit_file");
      expect(response.toolCalls![0].arguments).toEqual({ filePath: "src/index.ts" });
    });
  });

  describe("MimoProvider", () => {
    it("calls Mimo API and parses content & function calls", async () => {
      const provider = new MimoProvider({ model: "mimo-v2.5-pro" });
      const response = await provider.complete([{ role: "user", content: "hello" }]);

      expect(response.content).toBe("Hello from Mimo!");
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0].name).toBe("grep_search");
      expect(response.toolCalls![0].arguments).toEqual({ query: "MimoProvider" });
      expect(https.request).toHaveBeenCalledWith(
        expect.objectContaining({
          hostname: "opengateway.gitlawb.com",
          path: "/v1/chat/completions"
        }),
        expect.any(Function)
      );
    });
  });
});
