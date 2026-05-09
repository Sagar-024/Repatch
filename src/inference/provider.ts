// LiteLLM wrapper - Model agnostic inference

interface LLMMessage {
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
 * Default to Anthropic or OpenAI based on environment
 */
export function createProvider(config: ProviderConfig): LLMProvider {
  const providerType = config.model.startsWith("claude")
    ? "anthropic"
    : config.model.startsWith("ollama")
    ? "ollama"
    : "openai";

  switch (providerType) {
    case "anthropic":
      return new AnthropicProvider(config);
    case "ollama":
      return new OllamaProvider(config);
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
    const apiKey = this.config.apiKey || process.env.OPENAI_API_KEY;
    const baseUrl = this.config.baseUrl || "https://api.openai.com/v1";

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
      throw new Error(`OpenAI API error: ${response.statusText}`);
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

class OllamaProvider implements LLMProvider {
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  async complete(messages: LLMMessage[], tools?: ToolDefinition[]): Promise<LLMResponse> {
    const baseUrl = this.config.baseUrl || "http://localhost:11434";

    // Use v1/chat/completions endpoint for tool support
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.config.model.replace("ollama/", ""),
        messages: messages,
        tools: tools?.map(t => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters
          }
        })),
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    const data = await response.json() as {
      choices: Array<{
        message: {
          content?: string;
          tool_calls?: Array<{ function: { name: string; arguments: string } }>
        }
      }>;
    };

    const message = data.choices[0]?.message;
    const content = message?.content || "";

    // Check for structured tool_calls
    let toolCalls: ToolCall[] | undefined = message?.tool_calls?.map(tc => ({
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments)
    }));

    // If no structured tool_calls, try to parse tool-like JSON from content
    if (!toolCalls || toolCalls.length === 0) {
      const parsed = parseToolCallFromContent(content);
      if (parsed) {
        toolCalls = [parsed];
      }
    }

    return { content, toolCalls: toolCalls?.length ? toolCalls : undefined };
  }
}

/**
 * Parse tool call from content when not in structured format
 * Handles responses like: {"name": "list_files", "arguments": {"dirPath": "/tmp"}}
 * or: {'name': 'list_files', 'arguments': {'dirPath': '/tmp'}}
 * or: 1. {"name": "list_files", ...}
 * or: ```json {"name": ...} ```
 */
function parseToolCallFromContent(content: string): ToolCall | null {
  // Remove markdown code blocks
  let cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "");
  // Remove numbering like "1. " or "2. " at start of lines
  cleaned = cleaned.replace(/^\d+\.\s*/gm, "");

  try {
    // Try to parse the entire content as JSON first
    const parsed = JSON.parse(cleaned);
    if (parsed.name && parsed.arguments && typeof parsed.name === "string") {
      return {
        name: parsed.name,
        arguments: parsed.arguments
      };
    }
  } catch {
    // Not a JSON object at top level
  }

  // Try to find complete JSON objects by splitting on "}\n{" or "}{"
  // Handle both: {"name": ...}\n{"name": ...} and {"name": ...}{"name": ...}
  const jsonObjects = cleaned.split(/(?<=})\s*(?=\{)/);

  for (const obj of jsonObjects) {
    const trimmed = obj.trim();
    if (!trimmed) continue;

    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.name && parsed.arguments) {
        return {
          name: parsed.name,
          arguments: parsed.arguments
        };
      }
    } catch {
      // Not valid JSON, try next
    }
  }

  // Fallback: try to find any JSON-like object with name and arguments
  const jsonLikePattern = /\{[^{}]*"name"[^{}]*"arguments"[^{}]*\}/g;
  const matches = cleaned.match(jsonLikePattern);

  if (matches) {
    for (const match of matches) {
      try {
        const parsed = JSON.parse(match.replace(/'/g, '"'));
        if (parsed.name && parsed.arguments) {
          return {
            name: parsed.name,
            arguments: parsed.arguments
          };
        }
      } catch {
        // Try next
      }
    }
  }

  return null;
}

/**
 * Get the configured model from environment
 */
export function getDefaultModel(): string {
  // Default to Ollama with qwen2.5-coder:7b
  return process.env.AI_MODEL || "ollama/qwen2.5-coder:7b";
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
    }
  ];
}