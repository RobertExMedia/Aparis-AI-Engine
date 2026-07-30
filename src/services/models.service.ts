import { getAIProvider } from '../providers/index.js';
import type { AIModelInfo } from '../types/index.js';

export class ModelsService {
  async list(): Promise<AIModelInfo[]> {
    return getAIProvider().models();
  }
}

export const modelsService = new ModelsService();
