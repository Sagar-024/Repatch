const SECRET_PATTERNS = [
  /ghp_[a-zA-Z0-9]{36}/g,           // GitHub Personal Access Token
  /github_pat_[a-zA-Z0-9_]{82}/g,   // GitHub Fine-grained PAT
  /sk-[a-zA-Z0-9]{48}/g,            // OpenAI API Key
  /AIza[0-9A-Za-z-_]{35}/g,         // Google API Key
];

export function maskSecrets(text: string): string {
  if (!text) return text;
  
  let masked = text;
  for (const pattern of SECRET_PATTERNS) {
    masked = masked.replace(pattern, "[REDACTED]");
  }
  
  return masked;
}

export function maskObject<T>(obj: T): T {
  const json = JSON.stringify(obj);
  const maskedJson = maskSecrets(json);
  return JSON.parse(maskedJson);
}
