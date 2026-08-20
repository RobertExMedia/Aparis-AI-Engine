import type { FastifyReply, FastifyRequest } from 'fastify';
import { healthService } from '../services/health.service.js';

export class HealthController {
  async check(_request: FastifyRequest, reply: FastifyReply) {
    const result = await healthService.check();
    const statusCode = result.status === 'ok' ? 200 : 503;
    return reply.status(statusCode).send(result);
  }
}

export const healthController = new HealthController();
