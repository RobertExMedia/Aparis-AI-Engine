import type { FastifyReply, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { requireSupabaseAuth } from '../middleware/auth.js';
import { workspaceAuthorizationService } from '../services/workspace-authorization.service.js';
import { supabaseAgentRepository } from '../repositories/supabase/agent.repository.js';
import { supabaseKnowledgeRepository } from '../repositories/supabase/knowledge.repository.js';
import { enqueueKnowledgeProcess } from '../workers/knowledge.worker.js';
import {
  knowledgeJobProgressStore,
  toJobApiResponse,
} from '../services/knowledge-job-progress.service.js';
import { displayStageName } from '../knowledge/processing-stages.js';
import { ValidationError } from '../utils/errors.js';
import type { KnowledgeType } from '../knowledge/types.js';
const sourceCreateSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  type: z.enum([
    'documents',
    'website',
    'sitemap',
    'urls',
    'faq',
    'table',
    'text',
    'catalog',
    'policies',
    'internal_docs',
  ]),
  language: z.string().max(16).optional(),
  category: z.string().max(200).nullable().optional(),
  tags: z.array(z.string().max(64)).max(50).optional(),
  settings: z.record(z.unknown()).optional(),
});

const processSchema = z.object({
  workspaceId: z.string().uuid(),
  processing: z
    .object({
      chunkSize: z.number().int().min(100).max(4000).optional(),
      chunkOverlap: z.number().int().min(0).max(1000).optional(),
      removeDuplicates: z.boolean().optional(),
      embeddingModel: z.string().optional(),
    })
    .optional(),
});

const assignSchema = z.object({
  workspaceId: z.string().uuid(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  required: z.boolean().optional(),
});

function jobIdempotencyKey(
  sourceId: string,
  reprocess: boolean,
  processing: unknown,
): string {
  const hash = createHash('sha256')
    .update(JSON.stringify({ sourceId, reprocess, processing }))
    .digest('hex')
    .slice(0, 24);
  return `ks-${sourceId}-${reprocess ? 'r' : 'p'}-${hash}`;
}

export class KnowledgeController {
  async listSources(request: FastifyRequest, reply: FastifyReply) {
    requireSupabaseAuth(request.auth);
    const workspaceId = (request.query as { workspaceId?: string }).workspaceId;
    if (!workspaceId) throw new ValidationError('workspaceId is required');
    await workspaceAuthorizationService.assertMembership({
      accessToken: request.auth.accessToken,
      userId: request.auth.userId,
      workspaceId,
    });
    const sources = await supabaseKnowledgeRepository.listSources(
      request.auth.accessToken,
      workspaceId,
    );
    return reply.send(sources);
  }

  async createSource(request: FastifyRequest, reply: FastifyReply) {
    requireSupabaseAuth(request.auth);
    const parsed = sourceCreateSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError('Invalid source payload', parsed.error.flatten());

    await workspaceAuthorizationService.assertMembership({
      accessToken: request.auth.accessToken,
      userId: request.auth.userId,
      workspaceId: parsed.data.workspaceId,
    });

    const source = await supabaseKnowledgeRepository.createSource(request.auth.accessToken, {
      workspaceId: parsed.data.workspaceId,
      createdBy: request.auth.userId,
      name: parsed.data.name,
      description: parsed.data.description,
      type: parsed.data.type as KnowledgeType,
      language: parsed.data.language,
      category: parsed.data.category,
      tags: parsed.data.tags,
      settings: parsed.data.settings,
    });
    return reply.status(201).send(source);
  }

  async getSource(request: FastifyRequest, reply: FastifyReply) {
    requireSupabaseAuth(request.auth);
    const { id } = request.params as { id: string };
    const source = await supabaseKnowledgeRepository.getSource(request.auth.accessToken, id);
    await workspaceAuthorizationService.assertMembership({
      accessToken: request.auth.accessToken,
      userId: request.auth.userId,
      workspaceId: source.workspace_id,
    });
    return reply.send(source);
  }

  async patchSource(request: FastifyRequest, reply: FastifyReply) {
    requireSupabaseAuth(request.auth);
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : undefined;
    const source = await supabaseKnowledgeRepository.getSource(request.auth.accessToken, id);
    const ws = workspaceId ?? source.workspace_id;
    await workspaceAuthorizationService.assertMembership({
      accessToken: request.auth.accessToken,
      userId: request.auth.userId,
      workspaceId: ws,
    });

    const allowed = [
      'name',
      'description',
      'status',
      'language',
      'category',
      'tags',
      'visibility',
      'settings',
      'error_message',
    ] as const;
    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) patch[key] = body[key];
    }

    const updated = await supabaseKnowledgeRepository.updateSource(
      request.auth.accessToken,
      id,
      ws,
      patch,
    );
    return reply.send(updated);
  }

  async deleteSource(request: FastifyRequest, reply: FastifyReply) {
    requireSupabaseAuth(request.auth);
    const { id } = request.params as { id: string };
    const source = await supabaseKnowledgeRepository.getSource(request.auth.accessToken, id);
    await workspaceAuthorizationService.assertMembership({
      accessToken: request.auth.accessToken,
      userId: request.auth.userId,
      workspaceId: source.workspace_id,
    });
    await supabaseKnowledgeRepository.deleteSource(
      request.auth.accessToken,
      id,
      source.workspace_id,
    );
    return reply.status(204).send();
  }

  async processSource(request: FastifyRequest, reply: FastifyReply) {
    return this.enqueueOrRun(request, reply, false);
  }

  async reprocessSource(request: FastifyRequest, reply: FastifyReply) {
    return this.enqueueOrRun(request, reply, true);
  }

  private async enqueueOrRun(
    request: FastifyRequest,
    reply: FastifyReply,
    reprocess: boolean,
  ) {
    requireSupabaseAuth(request.auth);
    const { id } = request.params as { id: string };
    const parsed = processSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError('Invalid process payload', parsed.error.flatten());

    await workspaceAuthorizationService.assertMembership({
      accessToken: request.auth.accessToken,
      userId: request.auth.userId,
      workspaceId: parsed.data.workspaceId,
    });

    await supabaseKnowledgeRepository.assertSourceInWorkspace(
      request.auth.accessToken,
      id,
      parsed.data.workspaceId,
    );

    await supabaseKnowledgeRepository.updateSource(
      request.auth.accessToken,
      id,
      parsed.data.workspaceId,
      { status: 'processing', error_message: null },
    );

    const jobData = {
      accessToken: request.auth.accessToken,
      workspaceId: parsed.data.workspaceId,
      sourceId: id,
      processing: parsed.data.processing,
      reprocess,
      actorId: request.auth.userId,
      idempotencyKey: jobIdempotencyKey(id, reprocess, parsed.data.processing),
    };

    // Always enqueue so progress is pollable and jobs survive API restarts via Redis/BullMQ.
    const { jobId } = await enqueueKnowledgeProcess(jobData);
    const job = await knowledgeJobProgressStore.require(jobId);

    const label = displayStageName(job.currentStage);
    return reply.status(202).send({
      status: 'queued',
      jobId,
      job: {
        ...toJobApiResponse(job),
        current_stage_label: label,
        stageLabel: label,
      },
    });
  }

  async getJob(request: FastifyRequest, reply: FastifyReply) {
    requireSupabaseAuth(request.auth);
    const { id } = request.params as { id: string };
    const job = await knowledgeJobProgressStore.require(id);

    await workspaceAuthorizationService.assertMembership({
      accessToken: request.auth.accessToken,
      userId: request.auth.userId,
      workspaceId: job.workspaceId,
    });

    const label =
      job.status === 'failed' && job.failedStage
        ? displayStageName(job.failedStage)
        : displayStageName(job.currentStage);
    return reply.send({
      ...toJobApiResponse(job),
      current_stage_label: label,
      stageLabel: label,
      failed_stage_label:
        job.failedStage != null ? displayStageName(job.failedStage) : null,
      failedStageLabel:
        job.failedStage != null ? displayStageName(job.failedStage) : null,
    });
  }

  async listChunks(request: FastifyRequest, reply: FastifyReply) {
    requireSupabaseAuth(request.auth);
    const { id } = request.params as { id: string };
    const source = await supabaseKnowledgeRepository.getSource(request.auth.accessToken, id);
    await workspaceAuthorizationService.assertMembership({
      accessToken: request.auth.accessToken,
      userId: request.auth.userId,
      workspaceId: source.workspace_id,
    });
    const chunks = await supabaseKnowledgeRepository.listChunks(request.auth.accessToken, id);
    return reply.send(chunks);
  }

  async patchChunk(request: FastifyRequest, reply: FastifyReply) {
    requireSupabaseAuth(request.auth);
    const { chunkId } = request.params as { chunkId: string };
    const body = request.body as { content?: string; workspaceId?: string };
    if (!body.workspaceId) throw new ValidationError('workspaceId is required');
    await workspaceAuthorizationService.assertMembership({
      accessToken: request.auth.accessToken,
      userId: request.auth.userId,
      workspaceId: body.workspaceId,
    });
    const chunk = await supabaseKnowledgeRepository.updateChunk(
      request.auth.accessToken,
      chunkId,
      body.workspaceId,
      { content: body.content },
    );
    return reply.send(chunk);
  }

  async deleteChunk(request: FastifyRequest, reply: FastifyReply) {
    requireSupabaseAuth(request.auth);
    const { chunkId } = request.params as { chunkId: string };
    const workspaceId = (request.query as { workspaceId?: string }).workspaceId;
    if (!workspaceId) throw new ValidationError('workspaceId is required');
    await workspaceAuthorizationService.assertMembership({
      accessToken: request.auth.accessToken,
      userId: request.auth.userId,
      workspaceId,
    });
    await supabaseKnowledgeRepository.deleteChunk(
      request.auth.accessToken,
      chunkId,
      workspaceId,
    );
    return reply.status(204).send();
  }

  async attachToAgent(request: FastifyRequest, reply: FastifyReply) {
    requireSupabaseAuth(request.auth);
    const { agentId, sourceId } = request.params as { agentId: string; sourceId: string };
    const parsed = assignSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError('Invalid assignment payload', parsed.error.flatten());

    await workspaceAuthorizationService.assertMembership({
      accessToken: request.auth.accessToken,
      userId: request.auth.userId,
      workspaceId: parsed.data.workspaceId,
    });
    await supabaseAgentRepository.loadAgentConfiguration(
      agentId,
      parsed.data.workspaceId,
      request.auth.accessToken,
    );
    await supabaseKnowledgeRepository.assertSourceInWorkspace(
      request.auth.accessToken,
      sourceId,
      parsed.data.workspaceId,
    );

    const row = await supabaseKnowledgeRepository.attachToAgent(request.auth.accessToken, {
      workspaceId: parsed.data.workspaceId,
      agentId,
      sourceId,
      enabled: parsed.data.enabled,
      priority: parsed.data.priority,
      required: parsed.data.required,
    });
    return reply.status(201).send(row);
  }

  async patchAgentSource(request: FastifyRequest, reply: FastifyReply) {
    requireSupabaseAuth(request.auth);
    const { agentId, sourceId } = request.params as { agentId: string; sourceId: string };
    const body = request.body as {
      workspaceId?: string;
      enabled?: boolean;
      priority?: number;
      required?: boolean;
    };
    if (!body.workspaceId) throw new ValidationError('workspaceId is required');
    await workspaceAuthorizationService.assertMembership({
      accessToken: request.auth.accessToken,
      userId: request.auth.userId,
      workspaceId: body.workspaceId,
    });
    await supabaseAgentRepository.loadAgentConfiguration(
      agentId,
      body.workspaceId,
      request.auth.accessToken,
    );
    const row = await supabaseKnowledgeRepository.patchAgentSource(
      request.auth.accessToken,
      agentId,
      sourceId,
      body.workspaceId,
      {
        enabled: body.enabled,
        priority: body.priority,
        required: body.required,
      },
    );
    return reply.send(row);
  }

  async detachFromAgent(request: FastifyRequest, reply: FastifyReply) {
    requireSupabaseAuth(request.auth);
    const { agentId, sourceId } = request.params as { agentId: string; sourceId: string };
    const workspaceId = (request.query as { workspaceId?: string }).workspaceId;
    if (!workspaceId) throw new ValidationError('workspaceId query param is required');
    await workspaceAuthorizationService.assertMembership({
      accessToken: request.auth.accessToken,
      userId: request.auth.userId,
      workspaceId,
    });
    await supabaseAgentRepository.loadAgentConfiguration(
      agentId,
      workspaceId,
      request.auth.accessToken,
    );
    await supabaseKnowledgeRepository.detachFromAgent(
      request.auth.accessToken,
      agentId,
      sourceId,
      workspaceId,
    );
    return reply.status(204).send();
  }
}

export const knowledgeController = new KnowledgeController();
