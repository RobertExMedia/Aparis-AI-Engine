import type { FastifyReply, FastifyRequest } from 'fastify';
import { chatService } from '../services/chat.service.js';
import { requireSupabaseAuth } from '../middleware/auth.js';
import { recordUsage } from '../middleware/usage.js';
import { dashboardChatBodySchema } from '../types/schemas.js';
import { workspaceAuthorizationService } from '../services/workspace-authorization.service.js';
import { aiCreditsService } from '../services/ai-credits.service.js';
import { supabaseAgentRepository } from '../repositories/supabase/agent.repository.js';
import {
  AppError,
  ValidationError,
} from '../utils/errors.js';

function writeSse(reply: FastifyReply, event: string, data: unknown): void {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export class ChatController {
  async chat(request: FastifyRequest, reply: FastifyReply) {
    requireSupabaseAuth(request.auth);
    const parsed = dashboardChatBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid chat request', parsed.error.flatten());
    }

    const result = await chatService.chat({
      request: parsed.data,
      userId: request.auth.userId,
      accessToken: request.auth.accessToken,
      authMethod: request.auth.method,
    });

    recordUsage(request, {
      messageCount: 2,
      promptTokens: result.usage?.promptTokens,
      completionTokens: result.usage?.completionTokens,
      totalTokens: result.usage?.totalTokens,
    });

    if (result.credits) {
      request.creditsMeta = {
        workspaceId: parsed.data.workspaceId,
        credits: result.credits,
        settled: true,
      };
    }

    return reply.status(200).send(result);
  }

  async stream(request: FastifyRequest, reply: FastifyReply) {
    requireSupabaseAuth(request.auth);
    const parsed = dashboardChatBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid chat request', parsed.error.flatten());
    }

    // Preflight authz so 401/403/404/409/429 are normal HTTP responses (not SSE)
    await workspaceAuthorizationService.assertMembership({
      accessToken: request.auth.accessToken,
      userId: request.auth.userId,
      workspaceId: parsed.data.workspaceId,
    });
    await supabaseAgentRepository.loadAgentConfiguration(
      parsed.data.agentId,
      parsed.data.workspaceId,
      request.auth.accessToken,
    );
    // Credits already checked by requireAiCredits preHandler; re-assert for SSE safety.
    await aiCreditsService.assertAvailable(
      request.auth.accessToken,
      parsed.data.workspaceId,
    );

    const abort = new AbortController();
    const onClose = () => abort.abort();
    request.raw.on('close', onClose);

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    try {
      for await (const evt of chatService.streamChat({
        request: parsed.data,
        userId: request.auth.userId,
        accessToken: request.auth.accessToken,
        authMethod: request.auth.method,
        signal: abort.signal,
      })) {
        if (abort.signal.aborted) break;
        if (evt.event === 'done' && 'usage' in evt.data && evt.data.usage) {
          recordUsage(request, {
            messageCount: 2,
            promptTokens: evt.data.usage.promptTokens,
            completionTokens: evt.data.usage.completionTokens,
            totalTokens: evt.data.usage.totalTokens,
          });
          if ('credits' in evt.data && evt.data.credits) {
            request.creditsMeta = {
              workspaceId: parsed.data.workspaceId,
              credits: evt.data.credits,
              settled: true,
            };
          }
        }
        writeSse(reply, evt.event, evt.data);
      }
    } catch (err) {
      if (!abort.signal.aborted && !reply.raw.writableEnded) {
        writeSse(reply, 'error', {
          message: 'The AI service is temporarily unavailable.',
        });
        request.log.error(
          { err: err instanceof AppError ? { code: err.code } : err },
          'SSE stream error',
        );
      }
    } finally {
      request.raw.off('close', onClose);
      recordUsage(request, { messageCount: 2 });
      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
    }
  }
}

export const chatController = new ChatController();
