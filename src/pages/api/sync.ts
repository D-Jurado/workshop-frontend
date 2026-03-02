import type { APIRoute } from 'astro';
import {
  BedrockAgentClient,
  StartIngestionJobCommand,
  GetIngestionJobCommand
} from '@aws-sdk/client-bedrock-agent';

type SyncStatus = 'PENDIENTE' | 'EN_EJECUCION' | 'COMPLETADO' | 'FALLIDO';

type SyncExecution = {
  id: string;
  status: SyncStatus;
  logs: string[];
  startedAt: string;
  finishedAt?: string;
};

type StartSyncRequest = {
  region: string;
  knowledgeBaseId: string;
  dataSourceId: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  description?: string;
};

const executions = new Map<string, SyncExecution>();

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const addLog = (executionId: string, message: string): void => {
  const execution = executions.get(executionId);
  if (!execution) return;
  execution.logs.push(`[${new Date().toLocaleString('es-ES')}] ${message}`);
};

const runSyncProcess = async (executionId: string, payload: StartSyncRequest): Promise<void> => {
  try {
    const execution = executions.get(executionId);
    if (!execution) return;

    execution.status = 'EN_EJECUCION';

    const client = new BedrockAgentClient({
      region: payload.region,
      credentials: {
        accessKeyId: payload.accessKeyId,
        secretAccessKey: payload.secretAccessKey,
        sessionToken: payload.sessionToken || undefined
      }
    });

    addLog(executionId, 'Iniciando tarea de sincronización en Bedrock Knowledge Base...');

    const startResponse = await client.send(
      new StartIngestionJobCommand({
        knowledgeBaseId: payload.knowledgeBaseId,
        dataSourceId: payload.dataSourceId,
        description: payload.description || 'Sincronización ejecutada desde la interfaz de chat'
      })
    );

    const ingestionJobId = startResponse.ingestionJob?.ingestionJobId;

    if (!ingestionJobId) {
      throw new Error('No se recibió un ingestionJobId en la respuesta.');
    }

    addLog(executionId, `Ingestion Job iniciado: ${ingestionJobId}`);

    let currentStatus = startResponse.ingestionJob?.status;

    while (currentStatus === 'STARTING' || currentStatus === 'IN_PROGRESS') {
      await wait(4000);

      const statusResponse = await client.send(
        new GetIngestionJobCommand({
          knowledgeBaseId: payload.knowledgeBaseId,
          dataSourceId: payload.dataSourceId,
          ingestionJobId
        })
      );

      currentStatus = statusResponse.ingestionJob?.status;
      addLog(executionId, `Estado actual: ${currentStatus || 'DESCONOCIDO'}`);
    }

    if (currentStatus === 'COMPLETE') {
      execution.status = 'COMPLETADO';
      execution.finishedAt = new Date().toISOString();
      addLog(executionId, 'Sincronización completada correctamente.');
      return;
    }

    execution.status = 'FALLIDO';
    execution.finishedAt = new Date().toISOString();
    addLog(executionId, `Sincronización finalizó con estado: ${currentStatus || 'DESCONOCIDO'}`);
  } catch (error) {
    const execution = executions.get(executionId);
    if (!execution) return;

    execution.status = 'FALLIDO';
    execution.finishedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : 'Error no controlado en sincronización';
    addLog(executionId, `Error: ${message}`);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const payload = (await request.json()) as StartSyncRequest;

    if (
      !payload.region ||
      !payload.knowledgeBaseId ||
      !payload.dataSourceId ||
      !payload.accessKeyId ||
      !payload.secretAccessKey
    ) {
      return new Response(JSON.stringify({ error: 'Faltan parámetros de sincronización.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const executionId = crypto.randomUUID();

    executions.set(executionId, {
      id: executionId,
      status: 'PENDIENTE',
      logs: [`[${new Date().toLocaleString('es-ES')}] Ejecución creada.`],
      startedAt: new Date().toISOString()
    });

    void runSyncProcess(executionId, payload);

    return new Response(JSON.stringify({ executionId }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error no controlado al iniciar sincronización';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const GET: APIRoute = async ({ url }) => {
  const executionId = url.searchParams.get('executionId') || '';

  if (!executionId || !executions.has(executionId)) {
    return new Response(JSON.stringify({ error: 'No se encontró la ejecución solicitada.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const execution = executions.get(executionId)!;

  return new Response(JSON.stringify(execution), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};
