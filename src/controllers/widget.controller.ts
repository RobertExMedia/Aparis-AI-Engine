import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  authenticateWidget,
  requireWidgetAuth,
  widgetChatBodySchema,
} from '../middleware/widget-auth.js';
import { recordUsage } from '../middleware/usage.js';
import { widgetChatService } from '../services/widget-chat.service.js';
import { AppError, ValidationError } from '../utils/errors.js';

function writeSse(reply: FastifyReply, event: string, data: unknown): void {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export class WidgetController {
  async chat(request: FastifyRequest, reply: FastifyReply) {
    requireWidgetAuth(request.auth);
    const parsed = widgetChatBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid widget chat request', parsed.error.flatten());
    }
    if (!request.widgetAgent) {
      throw new ValidationError('Widget agent not resolved');
    }

    const result = await widgetChatService.chat({
      request: parsed.data,
      auth: request.auth,
      agent: request.widgetAgent,
    });

    recordUsage(request, { messageCount: 2 });

    return reply.status(200).send(result);
  }

  async stream(request: FastifyRequest, reply: FastifyReply) {
    requireWidgetAuth(request.auth);
    const parsed = widgetChatBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid widget chat request', parsed.error.flatten());
    }
    if (!request.widgetAgent) {
      throw new ValidationError('Widget agent not resolved');
    }

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
      for await (const evt of widgetChatService.streamChat({
        request: parsed.data,
        auth: request.auth,
        agent: request.widgetAgent,
        signal: abort.signal,
      })) {
        if (abort.signal.aborted) break;
        writeSse(reply, evt.event, evt.data);
      }
    } catch (err) {
      if (!abort.signal.aborted && !reply.raw.writableEnded) {
        writeSse(reply, 'error', {
          message: 'The AI service is temporarily unavailable.',
        });
        request.log.error(
          { err: err instanceof AppError ? { code: err.code } : err },
          'Widget SSE stream error',
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

export const widgetController = new WidgetController();

// Re-export authenticate for routes
export { authenticateWidget };
