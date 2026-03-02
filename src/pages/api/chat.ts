import type { APIRoute } from 'astro';
import { BedrockAgentRuntimeClient, InvokeAgentCommand } from '@aws-sdk/client-bedrock-agent-runtime';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type ChatRequest = {
  region: string;
  agentId: string;
  agentAliasId: string;
  sessionId?: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  messages: ChatMessage[];
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as ChatRequest;

    if (!body.region || !body.agentId || !body.agentAliasId || !body.accessKeyId || !body.secretAccessKey) {
      return new Response(JSON.stringify({ error: 'Faltan parámetros de configuración del agente Bedrock.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const client = new BedrockAgentRuntimeClient({
      region: body.region,
      credentials: {
        accessKeyId: body.accessKeyId,
        secretAccessKey: body.secretAccessKey,
        sessionToken: body.sessionToken || undefined
      }
    });

    const latestUserMessage = [...(body.messages || [])]
      .reverse()
      .find((item) => item?.role === 'user' && item?.content?.trim());

    if (!latestUserMessage) {
      return new Response(JSON.stringify({ error: 'No hay mensajes para enviar.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const sessionId = body.sessionId?.trim() || crypto.randomUUID();

    const command = new InvokeAgentCommand({
      agentId: body.agentId,
      agentAliasId: body.agentAliasId,
      sessionId,
      inputText: latestUserMessage.content
    });

    const response = await client.send(command);
    const decoder = new TextDecoder();
    let reply = '';

    if (response.completion) {
      for await (const chunkEvent of response.completion) {
        const bytes = chunkEvent.chunk?.bytes;
        if (bytes) {
          reply += decoder.decode(bytes, { stream: true });
        }
      }
      reply += decoder.decode();
    }

    const normalizedReply = reply.replace(/\u0000/g, '').trim();

    return new Response(JSON.stringify({ reply: normalizedReply || 'No se recibió texto del agente.', sessionId }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error no controlado en Bedrock.';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
