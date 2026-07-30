import type { FastifyReply, FastifyRequest } from 'fastify';
import { modelsService } from '../services/models.service.js';

export class ModelsController {
  async list(_request: FastifyRequest, reply: FastifyReply) {
    const models = await modelsService.list();
    return reply.status(200).send({
      models,
      defaultChatModel: process.env.OLLAMA_CHAT_MODEL ?? 'deepseek-r1:latest',
      defaultEmbedModel: process.env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text',
    });
  }
}

export const modelsController = new ModelsController();
