import type { APIRoute } from 'astro';
import { DeleteObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const sanitizeFileName = (name: string): string => name.replace(/[^a-zA-Z0-9._-]/g, '_');

const getS3Client = (
  region: string,
  accessKeyId: string,
  secretAccessKey: string,
  sessionToken?: string
): S3Client =>
  new S3Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
      sessionToken: sessionToken || undefined
    }
  });

export const POST: APIRoute = async ({ request }) => {
  try {
    const formData = await request.formData();

    const file = formData.get('file');
    const region = String(formData.get('region') || '');
    const bucketName = String(formData.get('bucketName') || '');
    const accessKeyId = String(formData.get('accessKeyId') || '');
    const secretAccessKey = String(formData.get('secretAccessKey') || '');
    const sessionToken = String(formData.get('sessionToken') || '');
    const prefix = String(formData.get('prefix') || 'documentos');

    if (!(file instanceof File)) {
      return new Response(JSON.stringify({ error: 'Debe seleccionar un archivo PDF.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (file.type !== 'application/pdf') {
      return new Response(JSON.stringify({ error: 'El archivo debe ser PDF.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!region || !bucketName || !accessKeyId || !secretAccessKey) {
      return new Response(JSON.stringify({ error: 'Faltan parámetros de S3.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const key = `${prefix.replace(/\/$/, '')}/${Date.now()}-${sanitizeFileName(file.name)}`;

    const client = getS3Client(region, accessKeyId, secretAccessKey, sessionToken);

    const buffer = await file.arrayBuffer();

    await client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: Buffer.from(buffer),
        ContentType: 'application/pdf'
      })
    );

    return new Response(JSON.stringify({ ok: true, bucketName, key }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error no controlado al cargar el PDF.';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const GET: APIRoute = async ({ url }) => {
  try {
    const region = url.searchParams.get('region') || '';
    const bucketName = url.searchParams.get('bucketName') || '';
    const accessKeyId = url.searchParams.get('accessKeyId') || '';
    const secretAccessKey = url.searchParams.get('secretAccessKey') || '';
    const sessionToken = url.searchParams.get('sessionToken') || '';
    const prefix = url.searchParams.get('prefix') || 'documentos';

    if (!region || !bucketName || !accessKeyId || !secretAccessKey) {
      return new Response(JSON.stringify({ error: 'Faltan parámetros de S3 para listar documentos.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const client = getS3Client(region, accessKeyId, secretAccessKey, sessionToken);
    const listResponse = await client.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: prefix
      })
    );

    const documents = (listResponse.Contents || [])
      .filter((item) => item.Key && item.Key !== `${prefix.replace(/\/$/, '')}/`)
      .map((item) => ({
        key: item.Key || '',
        size: item.Size || 0,
        lastModified: item.LastModified?.toISOString() || null
      }));

    return new Response(JSON.stringify({ documents }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error no controlado al listar documentos.';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

type DeleteRequest = {
  region: string;
  bucketName: string;
  key: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

export const DELETE: APIRoute = async ({ request }) => {
  try {
    const payload = (await request.json()) as DeleteRequest;

    if (!payload.region || !payload.bucketName || !payload.key || !payload.accessKeyId || !payload.secretAccessKey) {
      return new Response(JSON.stringify({ error: 'Faltan parámetros de S3 para eliminar el documento.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const client = getS3Client(
      payload.region,
      payload.accessKeyId,
      payload.secretAccessKey,
      payload.sessionToken
    );

    await client.send(
      new DeleteObjectCommand({
        Bucket: payload.bucketName,
        Key: payload.key
      })
    );

    return new Response(JSON.stringify({ ok: true, key: payload.key }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error no controlado al eliminar el documento.';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
