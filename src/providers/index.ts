import { OllamaProvider } from './ollama/ollama.provider.js';
import type { AIProvider } from './ai.provider.js';

let defaultProvider: AIProvider | null = null;

export function getAIProvider(): AIProvider {
  if (!defaultProvider) {
    defaultProvider = new OllamaProvider();
  }
  return defaultProvider;
}

export function setAIProvider(provider: AIProvider): void {
  defaultProvider = provider;
}

export { OllamaProvider };
export type { AIProvider } from './ai.provider.js';
