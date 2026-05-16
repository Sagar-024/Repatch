// LiteLLM wrapper - Model agnostic inference

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
}

interface ProviderConfig {
  model: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * LLM Provider interface
 */
export interface LLMProvider {
  complete(messages: LLMMessage[], tools?: ToolDefinition[]): Promise<LLMResponse>;
}

/**
 * Tool definition for the LLM
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * Create provider based on model prefix
 * Supports: openai/*, claude/*
 */
export function createProvider(config: ProviderConfig): LLMProvider {
  const providerType = config.model.startsWith("claude") ? "anthropic" : "openai";

  switch (providerType) {
    case "anthropic":
      return new AnthropicProvider(config);
    default:
      return new OpenAIProvider(config);
  }
}

class AnthropicProvider implements LLMProvider {
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  async complete(messages: LLMMessage[], tools?: ToolDefinition[]): Promise<LLMResponse> {
    const apiKey = this.config.apiKey || process.env.ANTHROPIC_API_KEY;
    const baseUrl = this.config.baseUrl || "https://api.anthropic.com";

    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey || "",
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        tools: tools?.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters
        })),
        max_tokens: this.config.maxTokens || 4096,
        temperature: this.config.temperature || 0
      })
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.statusText}`);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text?: string; name?: string; input?: unknown }>;
    };

    const content = data.content.find(c => c.type === "text")?.text || "";
    const toolCalls = data.content
      .filter(c => c.type === "tool_use")
      .map(c => ({
        name: c.name || "",
        arguments: (c.input as Record<string, unknown>) || {}
      }));

    return { content, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
  }
}

class OpenAIProvider implements LLMProvider {
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  async complete(messages: LLMMessage[], tools?: ToolDefinition[]): Promise<LLMResponse> {
    // Read API key from OPENAI_API_KEY
    const apiKey = this.config.apiKey || process.env.OPENAI_API_KEY;
    // Read base URL from OPENAI_API_BASE, defaulting to OpenCode Zen
    const baseUrl = this.config.baseUrl || process.env.OPENAI_API_BASE || "https://opencode.ai/zen/v1";

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey || ""}`
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: messages,
        tools: tools?.map(t => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters
          }
        })),
        temperature: this.config.temperature || 0,
        max_tokens: this.config.maxTokens
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content?: string; tool_calls?: Array<{ function: { name: string; arguments: string } }> } }>;
    };

    const message = data.choices[0]?.message;
    const content = message?.content || "";
    const toolCalls = message?.tool_calls?.map(tc => ({
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments)
    }));

    return { content, toolCalls: toolCalls?.length ? toolCalls : undefined };
  }
}


/**
 * Get the configured model from environment
 * Default: deepseek-v4-flash-free
 */
export function getDefaultModel(): string {
  return process.env.AI_MODEL || "deepseek-v4-flash-free";
}

/**
 * Convert tools registry to ToolDefinition format for LLM
 */
export function getToolsForLLM(): ToolDefinition[] {
  return [
    {
      name: "list_files",
      description: "List files in a directory recursively. Returns an array of file paths.",
      parameters: {
        type: "object",
        properties: {
          dirPath: { type: "string", description: "The directory path to list files from" },
          pattern: { type: "string", description: "Optional regex pattern to filter files" }
        },
        required: ["dirPath"]
      }
    },
    {
      name: "read_file",
      description: "Read a file and return its content with line numbers. Returns path, content, and lineCount.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "The full path to the file to read" }
        },
        required: ["filePath"]
      }
    },
    {
      name: "grep_search",
      description: "Search for a pattern in files. Returns array of matches with file, line, and content.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "The regex pattern to search for" },
          dirPath: { type: "string", description: "The directory to search in" },
          extensions: { type: "array", items: { type: "string" }, description: "Optional file extensions to filter" }
        },
        required: ["pattern", "dirPath"]
      }
    },
    {
      name: "run_command",
      description: "Run a command inside a sandboxed Docker container. Returns stdout, stderr, and exitCode.",
      parameters: {
        type: "object",
        properties: {
          imageTag: { type: "string", description: "The Docker image tag to use" },
          cmd: { type: "string", description: "The command to run inside the container" }
        },
        required: ["imageTag", "cmd"]
      }
    },
    {
      name: "write_file",
      description: "Write content to a file. Creates the file or overwrites if exists. Returns success status.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "The full path to the file to write" },
          content: { type: "string", description: "The content to write to the file" }
        },
        required: ["filePath", "content"]
      }
    },
    {
      name: "create_reproduction_test",
      description: "Create a dedicated reproduction test file to prove a bug exists.",
      parameters: {
        type: "object",
        properties: {
          dirPath: { type: "string", description: "The directory to create the test in" },
          content: { type: "string", description: "The full content of the test file" },
          fileName: { type: "string", description: "The name of the test file (default: reproduce.test.ts)" }
        },
        required: ["dirPath", "content"]
      }
    }
  ];
}