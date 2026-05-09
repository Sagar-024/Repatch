// Zod-based tool call validation (simplified without zod dependency)

import { ToolCall } from "./provider.js";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate tool call arguments against a schema
 * This is a simplified validation without Zod
 */
export function validateToolCall(
  toolCall: ToolCall,
  schema: ToolSchema
): ValidationResult {
  const errors: string[] = [];
  const args = toolCall.arguments;

  // Check required properties
  if (schema.required) {
    for (const required of schema.required) {
      if (!(required in args)) {
        errors.push(`Missing required parameter: ${required}`);
      }
    }
  }

  // Check property types
  if (schema.properties) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      if (key in args) {
        const propDef = prop as { type: string };
        const value = args[key];
        const actualType = typeof value;

        // Handle array types
        if (propDef.type === "array" && Array.isArray(value)) {
          // Array validation - check item type
        }
        // Handle object types
        else if (propDef.type === "object" && typeof value === "object" && !Array.isArray(value)) {
          // Object validation
        }
        // Handle primitive types
        else if (propDef.type !== actualType && propDef.type !== "number" && propDef.type !== "integer") {
          // Allow number/integer coercion
          errors.push(`Invalid type for ${key}: expected ${propDef.type}, got ${actualType}`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export interface ToolSchema {
  type: string;
  properties?: Record<string, { type: string; description?: string }>;
  required?: string[];
}

/**
 * Validate and sanitize tool call arguments
 */
export function sanitizeToolCall(
  toolCall: ToolCall,
  schema: ToolSchema
): ToolCall {
  const validated = validateToolCall(toolCall, schema);

  if (!validated.valid) {
    console.warn(`Tool call validation warnings: ${validated.errors.join(", ")}`);
  }

  // Basic sanitization - remove any unexpected properties
  const allowedProps = schema.properties ? Object.keys(schema.properties) : [];
  const sanitizedArgs: Record<string, unknown> = {};

  for (const key of allowedProps) {
    if (key in toolCall.arguments) {
      sanitizedArgs[key] = toolCall.arguments[key];
    }
  }

  return {
    ...toolCall,
    arguments: sanitizedArgs
  };
}

/**
 * Correction prompt for invalid tool calls
 */
export function generateCorrectionPrompt(
  toolCall: ToolCall,
  errors: string[]
): string {
  return `The tool call '${toolCall.name}' had the following errors:
${errors.map(e => `- ${e}`).join("\n")}

Please provide corrected arguments for the tool call.`;
}