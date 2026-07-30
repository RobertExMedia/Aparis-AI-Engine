import type { FastifyReply, FastifyRequest } from 'fastify';
import { chatService } from '../services/chat.service.js';
import { assertWorkspaceAccess } from '../middleware/auth.js';
import { recordUsage } from '../middleware/usage.js';
import { chatBodySchema } from '../types/schemas.js';
import { ValidationError } from '../utils/errors.js';

export class ChatController {
  async chat(request: FastifyRequest, reply: FastifyReply) {
    const parsed = chatBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid chat request', parsed.error.flatten());
    }

    const body = parsed.data;
    assertWorkspaceAccess(request.auth!, body.workspaceId);

    // Enforce tenant: always use authenticated workspace unless admin
    const workspaceId = request.auth!.isAdmin
      ? body.workspaceId
      : request.auth!.workspaceId;

    const result = await chatService.chat({
      ...body,
      workspaceId,
    });

    recordUsage(request, {
      messageCount: body.messages.length + 1,
      promptTokens: result.usage?.promptTokens,
      completionTokens: result.usage?.completionTokens,
      totalTokens: result.usage?.totalTokens,
    });

    return reply.status(200).send(result);
  }

  async stream(request: FastifyRequest, reply: FastifyReply) {
    const parsed = chatBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid chat request', parsed.error.flatten());
    }

    const body = parsed.data;
    assertWorkspaceAccess(request.auth!, body.workspaceId);

    const workspaceId = request.auth!.isAdmin
      ? body.workspaceId
      : request.auth!.workspaceId;

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let totalTokens: number | undefined;
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;

    try {
      for await (const chunk of chatService.streamChat({ ...body, workspaceId })) {
        const payload = JSON.stringify(chunk);
        reply.raw.write(`data: ${payload}\n\n`);

        if (chunk.done && chunk.usage) {
          totalTokens = chunk.usage.totalTokens;
          promptTokens = chunk.usage.promptTokens;
          completionTokens = chunk.usage.completionTokens;
        }
      }

      reply.raw.write('data: [DONE]\n\n');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Stream failed';
      reply.raw.write(
        `data: ${JSON.stringify({ error: { code: 'STREAM_ERROR', message: 'An error occurred while streaming' } })}\n\n`,
      );
      request.log.error({ err, message }, 'SSE stream error');
    } finally {
      recordUsage(request, {
        messageCount: body.messages.length + 1,
        promptTokens,
        completionTokens,
        totalTokens,
      });
      reply.raw.end();
    }
  }
}

export const chatController = new ChatController();
