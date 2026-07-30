import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config/index.js';
import { modelsService } from '../services/models.service.js';

export class ModelsController {
  async list(_request: FastifyRequest, reply: FastifyReply) {
    const models = await modelsService.list();
    return reply.status(200).send({
      models,
      defaultChatModel: config.ollama.chatModel,
      defaultEmbedModel: config.ollama.embedModel,
    });
  }
}

export const modelsController = new ModelsController();
