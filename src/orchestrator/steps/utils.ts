export function extractKeywords(text: string): string[] {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.keywords && Array.isArray(parsed.keywords)) {
        return parsed.keywords;
      }
    }
  } catch {
    // Not JSON, try to extract words
  }
  // Default keywords from issue text
  const words = text.split(/\s+/).filter(w => w.length > 3);
  return words.slice(0, 10);
}
