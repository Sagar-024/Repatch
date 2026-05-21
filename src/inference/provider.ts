import { execa } from "execa";
import { GoogleGenerativeAI } from "@google/generative-ai";
import http from "http";
import https from "https";
import { config } from "../config/loader.js";
import { logger } from "../utils/logger.js";

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface LLMResponse {
  content: string;
  raw?: string;
  toolCalls?: ToolCall[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ProviderConfig {
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMProvider {
  complete(messages: LLMMessage[], tools?: ToolDefinition[]): Promise<LLMResponse>;
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, baseDelay = 1000): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      logger.warn(`LLM call failed (attempt ${attempt + 1}/${maxRetries}): ${err}`);
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError;
}

export class GeminiCLIProvider implements LLMProvider {
  constructor(private providerConfig: ProviderConfig) {}

  async complete(messages: LLMMessage[], tools?: ToolDefinition[]): Promise<LLMResponse> {
    return withRetry(() => this._call(messages, tools), 3, 1500);
  }

  private async _call(messages: LLMMessage[], tools?: ToolDefinition[]): Promise<LLMResponse> {
    let prompt = "";
    const system = messages.find(m => m.role === "system");
    if (system) prompt += `${system.content}\n\n`;
    for (const m of messages.filter(m => m.role !== "system")) {
      prompt += `${m.role === "user" ? "User" : "Assistant"}: ${m.content}\n\n`;
    }
    prompt += "Assistant:";

    const args = ["--output-format", "json"];
    const model = this.providerConfig.model || config.model;
    if (model) args.push("-m", model);

    // Pass prompt via stdin using '-' as the prompt argument
    args.push("-p", "-");

    const { stdout } = await execa("gemini", args, {
      input: prompt,
      timeout: 60000
    });

    try {
      const parsed = JSON.parse(stdout);
      const content = parsed.response || "";

      const toolCalls: ToolCall[] = [];

      // Strategy 1: Try to find JSON blocks between ```json and ```
      const jsonBlockRegex = /```json\s*([\s\S]*?)```/g;
      let blockMatch;
      while ((blockMatch = jsonBlockRegex.exec(content)) !== null) {
        try {
          const parsedBlock = JSON.parse(blockMatch[1]);
          if (parsedBlock.name && parsedBlock.arguments) {
            toolCalls.push({
              id: `cli_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
              name: parsedBlock.name,
              arguments: typeof parsedBlock.arguments === "string" ? JSON.parse(parsedBlock.arguments) : parsedBlock.arguments
            });
          }
        } catch {
          // Skip invalid JSON block
        }
      }

      // Strategy 2: Try to parse the entire content as JSON (single tool call)
      if (toolCalls.length === 0) {
        try {
          const parsedContent = JSON.parse(content);
          if (parsedContent.name && parsedContent.arguments) {
            toolCalls.push({
              id: `cli_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
              name: parsedContent.name,
              arguments: typeof parsedContent.arguments === "string" ? JSON.parse(parsedContent.arguments) : parsedContent.arguments
            });
          }
        } catch {
          // Not valid JSON, fall through
        }
      }

      // Strategy 3: Regex fallback for embedded tool call objects
      if (toolCalls.length === 0) {
        const jsonRegex = /\{[\s\S]*?"name":\s*?"(\w+)"[\s\S]*?"arguments":\s*?(\{[\s\S]*?\})[\s\S]*?\}/g;
        let match;
        while ((match = jsonRegex.exec(content)) !== null) {
          try {
            const name = match[1];
            const argsStr = match[2];
            const args = JSON.parse(argsStr);
            toolCalls.push({
              id: `cli_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
              name,
              arguments: args
            });
          } catch {
            // Skip invalid JSON
          }
        }
      }

      return { content, toolCalls: toolCalls.length ? toolCalls : undefined, raw: stdout };
    } catch {
      return { content: stdout.trim(), raw: stdout };
    }
  }
}

function mapMessagesToAnthropic(messages: LLMMessage[]): any[] {
  const rest = messages.filter(m => m.role !== "system");
  return rest.map(m => {
    if (m.role === "tool") {
      return {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: m.toolCallId || "",
            content: m.content
          }
        ]
      };
    }
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      const contentParts: any[] = [];
      if (m.content) {
        contentParts.push({ type: "text", text: m.content });
      }
      m.toolCalls.forEach(tc => {
        contentParts.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: tc.arguments
        });
      });
      return {
        role: "assistant",
        content: contentParts
      };
    }
    return {
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content
    };
  });
}

export class AnthropicProvider implements LLMProvider {
  constructor(private providerConfig: ProviderConfig) {}

  async complete(messages: LLMMessage[], tools?: ToolDefinition[]): Promise<LLMResponse> {
    return withRetry(() => this._call(messages, tools), 2, 1000);
  }

  private async _call(messages: LLMMessage[], tools?: ToolDefinition[]): Promise<LLMResponse> {
    const apiKey = this.providerConfig.apiKey || config.anthropic?.apiKey;
    if (!apiKey) throw new Error("Anthropic API key is missing. Set ANTHROPIC_API_KEY or configure it in .repatch.yaml");

    const system = messages.find(m => m.role === "system")?.content;
    const rest = mapMessagesToAnthropic(messages);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: this.providerConfig.model || config.model || "claude-3-5-sonnet-latest",
        system,
        messages: rest,
        tools: tools?.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters
        })),
        max_tokens: this.providerConfig.maxTokens || 4096,
        temperature: this.providerConfig.temperature ?? 0
      })
    });

    if (!res.ok) throw new Error(`Anthropic error: ${res.status} ${await res.text()}`);
    const data = await res.json() as any;
    const content = data.content.find((c: any) => c.type === "text")?.text || "";
    const toolCalls = data.content
      .filter((c: any) => c.type === "tool_use")
      .map((c: any) => ({ id: c.id, name: c.name, arguments: c.input }));

    const usage = data.usage ? {
      promptTokens: data.usage.input_tokens,
      completionTokens: data.usage.output_tokens,
      totalTokens: data.usage.input_tokens + data.usage.output_tokens
    } : undefined;

    return { content, toolCalls: toolCalls.length ? toolCalls : undefined, usage };
  }
}

function mapMessagesToOpenAI(messages: LLMMessage[]): any[] {
  return messages.map(m => {
    if (m.role === "tool") {
      return {
        role: "tool",
        tool_call_id: m.toolCallId || "",
        name: m.name,
        content: m.content
      };
    }
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map(tc => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments)
          }
        }))
      };
    }
    return {
      role: m.role,
      content: m.content
    };
  });
}

function mapMessagesToMimo(messages: LLMMessage[]): any[] {
  return messages.map(m => {
    if (m.role === "tool") {
      return {
        role: "tool",
        tool_call_id: m.toolCallId || "call_default",
        content: m.content
      };
    }
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      const toolCallsText = m.toolCalls.map(tc => {
        let parsedArgs = tc.arguments;
        if (typeof tc.arguments === "string") {
          try {
            parsedArgs = JSON.parse(tc.arguments);
          } catch {
            parsedArgs = tc.arguments;
          }
        }
        return `<tool_call>\n${JSON.stringify({ name: tc.name, args: parsedArgs })}\n</tool_call>`;
      }).join("\n");
      
      return {
        role: "assistant",
        content: (m.content || "") + (m.content ? "\n" : "") + toolCallsText
      };
    }
    return {
      role: m.role,
      content: m.content
    };
  });
}

export class OpenAIProvider implements LLMProvider {
  constructor(private providerConfig: ProviderConfig) {}

  async complete(messages: LLMMessage[], tools?: ToolDefinition[]): Promise<LLMResponse> {
    return withRetry(() => this._call(messages, tools), 2, 1000);
  }

  private async _call(messages: LLMMessage[], tools?: ToolDefinition[]): Promise<LLMResponse> {
    const apiKey = this.providerConfig.apiKey || config.openai?.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OpenAI API key is missing. Set OPENAI_API_KEY or configure it in .repatch.yaml");

    const baseUrl = this.providerConfig.baseUrl || config.openai?.baseUrl || process.env.OPENAI_API_BASE || "https://api.openai.com/v1";
    const model = this.providerConfig.model || config.model || "gpt-4o";

    const body: any = {
      model,
      messages: mapMessagesToOpenAI(messages),
    };

    if (tools && tools.length > 0) {
      body.tools = tools.map(t => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters }
      }));
    }

    if (this.providerConfig.temperature !== undefined) {
      body.temperature = this.providerConfig.temperature;
    }

    const bodyStr = JSON.stringify(body);
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${apiKey}`,
        "content-length": Buffer.byteLength(bodyStr).toString(),
        "user-agent": "curl/7.68.0"
      },
      body: bodyStr
    });

    logger.debug(`Request Body: ${JSON.stringify(body)}`);
    logger.debug(`Request Headers: ${JSON.stringify({ "content-type": "application/json", "authorization": "Bearer [REDACTED]" })}`);

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`OpenAI error: ${res.status} ${errorText}`);
    }

    const data = await res.json() as any;
    const msg = data.choices[0].message;
    const toolCalls = msg.tool_calls?.map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments
    }));

    const usage = data.usage ? {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens
    } : undefined;

    return {
      content: msg.content || "",
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      usage,
      raw: JSON.stringify(data)
    };
  }
}

function customRequest(urlStr: string, options: { method: string; headers: Record<string, string>; body: string }): Promise<{ ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<any> }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const client = url.protocol === "https:" ? https : http;
    
    const reqOptions = {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname + url.search,
      method: options.method,
      headers: {
        ...options.headers,
        "Content-Length": Buffer.byteLength(options.body).toString()
      }
    };

    const req = client.request(reqOptions, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        const status = res.statusCode || 200;
        resolve({
          ok: status >= 200 && status < 300,
          status,
          text: async () => data,
          json: async () => JSON.parse(data)
        });
      });
    });

    req.setTimeout(60000, () => {
      req.destroy(new Error("Request timeout after 60000ms"));
    });

    req.on("error", (err) => {
      reject(err);
    });

    req.write(options.body);
    req.end();
  });
}

export class MimoProvider implements LLMProvider {
  constructor(private providerConfig: ProviderConfig) {}

  async complete(messages: LLMMessage[], tools?: ToolDefinition[]): Promise<LLMResponse> {
    return withRetry(() => this._call(messages, tools), 2, 1000);
  }

  private async _call(messages: LLMMessage[], tools?: ToolDefinition[]): Promise<LLMResponse> {
    const apiKey = this.providerConfig.apiKey || config.mimo?.apiKey || process.env.MIMO_API_KEY;
    if (!apiKey) throw new Error("Mimo API key is missing. Set MIMO_API_KEY or configure it in .repatch.yaml");
    const baseUrl = this.providerConfig.baseUrl || config.mimo?.baseUrl || process.env.MIMO_API_BASE || process.env.MIMO_BASE_URL || "https://opengateway.gitlawb.com/v1";
    const model = this.providerConfig.model || config.model || "mimo-v2.5-pro";

    const body: any = {
      model,
      messages: mapMessagesToMimo(messages),
    };

    if (tools && tools.length > 0) {
      body.tools = tools.map(t => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters }
      }));
    }

    if (this.providerConfig.temperature !== undefined) {
      body.temperature = this.providerConfig.temperature;
    }

    const bodyStr = JSON.stringify(body);
    const res = await customRequest(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${apiKey}`,
        "user-agent": "curl/7.68.0"
      },
      body: bodyStr
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[Mimo Debug] Failed payload: ${bodyStr}`);
      throw new Error(`Mimo error: ${res.status} ${err}`);
    }

    const data = await res.json() as any;
    const msg = data.choices[0].message;
    const toolCalls = msg.tool_calls?.map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: typeof tc.function.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function.arguments
    }));

    const usage = data.usage ? {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens
    } : undefined;

    return {
      content: msg.content || "",
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      usage,
      raw: JSON.stringify(data)
    };
  }
}

function convertToGeminiSchema(schema: any): any {
  if (!schema) return undefined;
  const newSchema = { ...schema };
  if (typeof newSchema.type === "string") {
    newSchema.type = newSchema.type.toUpperCase();
  }
  if (newSchema.properties) {
    const newProps: Record<string, any> = {};
    for (const [key, value] of Object.entries(newSchema.properties)) {
      newProps[key] = convertToGeminiSchema(value);
    }
    newSchema.properties = newProps;
  }
  if (newSchema.items) {
    newSchema.items = convertToGeminiSchema(newSchema.items);
  }
  return newSchema;
}

function mapMessagesToGemini(messages: LLMMessage[]): { systemInstruction?: string; contents: any[] } {
  const systemMsg = messages.find(m => m.role === "system");
  const systemInstruction = systemMsg?.content;

  const rest = messages.filter(m => m.role !== "system");
  const contents = rest.map(m => {
    if (m.role === "tool") {
      let responseObj: any;
      try {
        responseObj = JSON.parse(m.content);
        if (typeof responseObj !== "object" || responseObj === null) {
          responseObj = { result: m.content };
        }
      } catch {
        responseObj = { result: m.content };
      }

      return {
        role: "function",
        parts: [
          {
            functionResponse: {
              name: m.name || "",
              response: responseObj
            }
          }
        ]
      };
    }

    const parts: any[] = [];
    if (m.content) {
      parts.push({ text: m.content });
    }

    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      m.toolCalls.forEach(tc => {
        parts.push({
          functionCall: {
            name: tc.name,
            args: tc.arguments
          }
        });
      });
      return {
        role: "model",
        parts
      };
    }

    return {
      role: m.role === "assistant" ? "model" : "user",
      parts
    };
  });

  return { systemInstruction, contents };
}

export class GeminiAPIProvider implements LLMProvider {
  constructor(private providerConfig: ProviderConfig) {}

  async complete(messages: LLMMessage[], tools?: ToolDefinition[]): Promise<LLMResponse> {
    return withRetry(() => this._call(messages, tools), 3, 1000);
  }

  private async _call(messages: LLMMessage[], tools?: ToolDefinition[]): Promise<LLMResponse> {
    const apiKey = this.providerConfig.apiKey || config.gemini?.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("Gemini API key is missing. Set GEMINI_API_KEY or configure it in .repatch.yaml");

    const modelName = this.providerConfig.model || config.model || "gemini-1.5-flash";
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName });

    const { systemInstruction, contents } = mapMessagesToGemini(messages);

    const geminiTools = tools && tools.length > 0 ? [{
      functionDeclarations: tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: convertToGeminiSchema(t.parameters)
      }))
    }] : undefined;

    const result = await model.generateContent({
      contents,
      systemInstruction,
      tools: geminiTools,
      generationConfig: {
        temperature: this.providerConfig.temperature ?? 0,
        maxOutputTokens: this.providerConfig.maxTokens
      }
    });

    const response = await result.response;
    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    let content = "";
    const toolCalls: ToolCall[] = [];

    for (const part of parts) {
      if (part.text) {
        content += part.text;
      }
      if (part.functionCall) {
        toolCalls.push({
          id: `gemini_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
          name: part.functionCall.name,
          arguments: (part.functionCall.args as Record<string, unknown>) || {}
        });
      }
    }

    const usage = response.usageMetadata ? {
      promptTokens: response.usageMetadata.promptTokenCount,
      completionTokens: response.usageMetadata.candidatesTokenCount,
      totalTokens: response.usageMetadata.totalTokenCount
    } : undefined;

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
      raw: JSON.stringify(response)
    };
  }
}

export function createProvider(providerConfig: ProviderConfig): LLMProvider {
  const model = providerConfig.model || config.model || "";

  // 1. Explicit Gemini models
  if (model.startsWith("gemini")) {
    const geminiApiKey = providerConfig.apiKey || config.gemini?.apiKey || process.env.GEMINI_API_KEY;
    if (geminiApiKey) {
      return new GeminiAPIProvider({ ...providerConfig, apiKey: geminiApiKey });
    }
    return new GeminiCLIProvider(providerConfig);
  }

  if (model.includes("mimo")) {
    return new MimoProvider(providerConfig);
  }

  // 2. Explicit Claude models ALWAYS use Anthropic
  if (model.startsWith("claude") || model.startsWith("anthropic")) {
    return new AnthropicProvider(providerConfig);
  }

  const baseUrl = providerConfig.baseUrl || config.openai?.baseUrl || process.env.OPENAI_API_BASE || "";
  const apiKey = providerConfig.apiKey || config.openai?.apiKey || process.env.OPENAI_API_KEY || "";

  // 3. If custom OpenAI gateway or explicit OpenAI/Mimo/DeepSeek model, use OpenAIProvider
  const isOpenAICompatible = baseUrl && !baseUrl.includes("api.openai.com");
  const isGPT = model.startsWith("gpt") || model.startsWith("deepseek");

  if (isOpenAICompatible || isGPT) {
    return new OpenAIProvider(providerConfig);
  }

  // 4. Fallback: If we have an API key, assume OpenAI compatible, otherwise Gemini CLI
  if (apiKey) return new OpenAIProvider(providerConfig);

  return new GeminiCLIProvider(providerConfig);
}

export function getDefaultModel(): string {
  return config.model;
}

export async function getToolsForLLM(): Promise<ToolDefinition[]> {
  const { tools } = await import("../tools/registry.js");
  return tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters }));
}
