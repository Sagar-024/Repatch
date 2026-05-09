// Activity stream reporter - Terminal output and event bus

export type LogLevel = "info" | "success" | "warning" | "error" | "debug";

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: number;
  step?: string;
}

export class Reporter {
  private logs: LogEntry[] = [];
  private verbose: boolean;

  constructor(verbose: boolean = false) {
    this.verbose = verbose;
  }

  log(level: LogLevel, message: string, step?: string): void {
    const entry: LogEntry = {
      level,
      message,
      timestamp: Date.now(),
      step
    };

    this.logs.push(entry);

    // Output to console with formatting
    const prefix = this.getPrefix(level, step);
    console.log(`${prefix} ${message}`);
  }

  info(message: string, step?: string): void {
    this.log("info", message, step);
  }

  success(message: string, step?: string): void {
    this.log("success", message, step);
  }

  warning(message: string, step?: string): void {
    this.log("warning", message, step);
  }

  error(message: string, step?: string): void {
    this.log("error", message, step);
  }

  debug(message: string, step?: string): void {
    if (this.verbose) {
      this.log("debug", message, step);
    }
  }

  getLogs(): LogEntry[] {
    return this.logs;
  }

  getSummary(): string {
    return this.logs.map(l => `[${l.level.toUpperCase()}] ${l.message}`).join("\n");
  }

  private getPrefix(level: LogLevel, step?: string): string {
    const stepPrefix = step ? `[${step}] ` : "";
    const symbols: Record<LogLevel, string> = {
      info: "ℹ️ ",
      success: "✅",
      warning: "⚠️",
      error: "❌",
      debug: "🔍"
    };

    return `${stepPrefix}${symbols[level]}`;
  }
}

export function createReporter(verbose: boolean = false): Reporter {
  return new Reporter(verbose);
}