import type { FastifyInstance } from 'fastify';
import { knowledgeController } from '../controllers/knowledge.controller.js';
import { authenticateSupabaseUser } from '../middleware/auth.js';
import { errorResponseJsonSchema } from '../types/schemas.js';

export async function knowledgeRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: [authenticateSupabaseUser] };

  app.get('/knowledge/sources', {
    ...auth,
    schema: {
      tags: ['Knowledge'],
      summary: 'List knowledge sources',
      security: [{ supabaseBearer: [] }],
      querystring: {
        type: 'object',
        required: ['workspaceId'],
        properties: { workspaceId: { type: 'string', format: 'uuid' } },
      },
      response: { 401: errorResponseJsonSchema, 403: errorResponseJsonSchema },
    },
  }, (req, reply) => knowledgeController.listSources(req, reply));

  app.post('/knowledge/sources', {
    ...auth,
    schema: {
      tags: ['Knowledge'],
      summary: 'Create knowledge source',
      security: [{ supabaseBearer: [] }],
      response: { 401: errorResponseJsonSchema, 403: errorResponseJsonSchema },
    },
  }, (req, reply) => knowledgeController.createSource(req, reply));

  app.get('/knowledge/sources/:id', {
    ...auth,
    schema: {
      tags: ['Knowledge'],
      summary: 'Get knowledge source',
      security: [{ supabaseBearer: [] }],
    },
  }, (req, reply) => knowledgeController.getSource(req, reply));

  app.patch('/knowledge/sources/:id', {
    ...auth,
    schema: {
      tags: ['Knowledge'],
      summary: 'Update knowledge source',
      security: [{ supabaseBearer: [] }],
    },
  }, (req, reply) => knowledgeController.patchSource(req, reply));

  app.delete('/knowledge/sources/:id', {
    ...auth,
    schema: {
      tags: ['Knowledge'],
      summary: 'Delete knowledge source',
      security: [{ supabaseBearer: [] }],
    },
  }, (req, reply) => knowledgeController.deleteSource(req, reply));

  app.post('/knowledge/sources/:id/process', {
    ...auth,
    schema: {
      tags: ['Knowledge'],
      summary: 'Process knowledge source (chunk + embed)',
      security: [{ supabaseBearer: [] }],
    },
  }, (req, reply) => knowledgeController.processSource(req, reply));

  app.post('/knowledge/sources/:id/reprocess', {
    ...auth,
    schema: {
      tags: ['Knowledge'],
      summary: 'Reprocess knowledge source',
      security: [{ supabaseBearer: [] }],
    },
  }, (req, reply) => knowledgeController.reprocessSource(req, reply));

  app.get('/knowledge/sources/:id/chunks', {
    ...auth,
    schema: {
      tags: ['Knowledge'],
      summary: 'List chunks for a source',
      security: [{ supabaseBearer: [] }],
    },
  }, (req, reply) => knowledgeController.listChunks(req, reply));

  app.patch('/knowledge/chunks/:chunkId', {
    ...auth,
    schema: {
      tags: ['Knowledge'],
      summary: 'Update a chunk',
      security: [{ supabaseBearer: [] }],
    },
  }, (req, reply) => knowledgeController.patchChunk(req, reply));

  app.delete('/knowledge/chunks/:chunkId', {
    ...auth,
    schema: {
      tags: ['Knowledge'],
      summary: 'Delete a chunk',
      security: [{ supabaseBearer: [] }],
    },
  }, (req, reply) => knowledgeController.deleteChunk(req, reply));

  app.post('/agents/:agentId/knowledge/:sourceId', {
    ...auth,
    schema: {
      tags: ['Knowledge'],
      summary: 'Assign knowledge source to agent',
      security: [{ supabaseBearer: [] }],
    },
  }, (req, reply) => knowledgeController.attachToAgent(req, reply));

  app.patch('/agents/:agentId/knowledge/:sourceId', {
    ...auth,
    schema: {
      tags: ['Knowledge'],
      summary: 'Update agent knowledge assignment',
      security: [{ supabaseBearer: [] }],
    },
  }, (req, reply) => knowledgeController.patchAgentSource(req, reply));

  app.delete('/agents/:agentId/knowledge/:sourceId', {
    ...auth,
    schema: {
      tags: ['Knowledge'],
      summary: 'Detach knowledge source from agent',
      security: [{ supabaseBearer: [] }],
    },
  }, (req, reply) => knowledgeController.detachFromAgent(req, reply));
}
