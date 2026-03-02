import type { APIRoute } from 'astro';
import { BedrockAgentClient, ListIngestionJobsCommand } from '@aws-sdk/client-bedrock-agent';

type SyncHistoryRequest = {
  region: string;
  knowledgeBaseId: string;
  dataSourceId: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  maxResults?: number;
};

type UiSyncStatus = 'PENDIENTE' | 'EN_EJECUCION' | 'COMPLETADO' | 'FALLIDO';

const mapAwsStatusToUiStatus = (status?: string): UiSyncStatus => {
  if (status === 'COMPLETE') return 'COMPLETADO';
  if (status === 'FAILED') return 'FALLIDO';
  if (status === 'IN_PROGRESS' || status === 'STARTING') return 'EN_EJECUCION';
  return 'PENDIENTE';
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const payload = (await request.json()) as SyncHistoryRequest;

    if (
      !payload.region ||
      !payload.knowledgeBaseId ||
      !payload.dataSourceId ||
      !payload.accessKeyId ||
      !payload.secretAccessKey
    ) {
      return new Response(JSON.stringify({ error: 'Faltan parámetros para consultar historial de sincronización.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const client = new BedrockAgentClient({
      region: payload.region,
      credentials: {
        accessKeyId: payload.accessKeyId,
        secretAccessKey: payload.secretAccessKey,
        sessionToken: payload.sessionToken || undefined
      }
    });

    const maxResults = Math.min(Math.max(Number(payload.maxResults || 30), 1), 100);

    const listResponse = await client.send(
      new ListIngestionJobsCommand({
        knowledgeBaseId: payload.knowledgeBaseId,
        dataSourceId: payload.dataSourceId,
        maxResults
      })
    );

    const executions = (listResponse.ingestionJobSummaries || []).map((job) => {
      const startedAt = job.startedAt ? new Date(job.startedAt).toISOString() : new Date().toISOString();
      const finishedAt = job.updatedAt ? new Date(job.updatedAt).toISOString() : undefined;
      const awsStatus = job.status || 'UNKNOWN';
      const uiStatus = mapAwsStatusToUiStatus(awsStatus);
      const ingestionJobId = job.ingestionJobId || 'sin-id';

      return {
        id: `aws-${ingestionJobId}`,
        source: 'AWS',
        jobId: ingestionJobId,
        status: uiStatus,
        startedAt,
        finishedAt,
        logs: [
          `[${new Date().toLocaleString('es-ES')}] Historial recuperado desde AWS.`,
          `Ingestion Job ID: ${ingestionJobId}`,
          `Estado AWS: ${awsStatus}`,
          `Iniciado: ${new Date(startedAt).toLocaleString('es-ES')}`,
          `Última actualización: ${finishedAt ? new Date(finishedAt).toLocaleString('es-ES') : 'No disponible'}`
        ]
      };
    });

    return new Response(JSON.stringify({ executions }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error no controlado consultando historial de sincronización';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
