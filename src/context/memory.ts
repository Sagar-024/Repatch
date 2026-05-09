// In-memory store for visited files and symbols
import { FileContext } from "./engine.js";

export interface Memory {
  visitedFiles: Map<string, FileContext>;
  searchedSymbols: Map<string, string[]>;
  failedCommands: string[];
  addedFiles: string[];
}

export function createMemory(): Memory {
  return {
    visitedFiles: new Map(),
    searchedSymbols: new Map(),
    failedCommands: [],
    addedFiles: []
  };
}

export function addVisitedFile(memory: Memory, file: FileContext): void {
  memory.visitedFiles.set(file.path, file);
}

export function addSearchedSymbol(memory: Memory, symbol: string, locations: string[]): void {
  memory.searchedSymbols.set(symbol, locations);
}

export function addFailedCommand(memory: Memory, command: string): void {
  memory.failedCommands.push(command);
}

export function addAddedFile(memory: Memory, filePath: string): void {
  memory.addedFiles.push(filePath);
}

export function getVisitedFiles(memory: Memory): FileContext[] {
  return Array.from(memory.visitedFiles.values());
}