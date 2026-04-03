const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'studio-4350140400-a3f8f';
const functionsRegion = process.env.FUNCTIONS_REGION || 'us-central1';
const functionsBaseUrl = `https://${functionsRegion}-${projectId}.cloudfunctions.net`;

function buildUpstreamHeaders(incoming: Headers) {
  const headers = new Headers();
  incoming.forEach((value, key) => {
    const normalized = key.toLowerCase();
    if (normalized === 'host' || normalized === 'content-length' || normalized === 'connection') return;
    headers.set(key, value);
  });
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return headers;
}

export async function proxyIotFunction(request: Request, functionName: 'iotDeviceBootstrap' | 'iotDeviceSync') {
  try {
    const body =
      request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await request.arrayBuffer();

    const upstream = await fetch(`${functionsBaseUrl}/${functionName}`, {
      method: request.method,
      headers: buildUpstreamHeaders(request.headers),
      body,
      redirect: 'manual',
    });

    const contentType = upstream.headers.get('content-type') || 'application/json; charset=utf-8';
    const responseBody = await upstream.arrayBuffer();
    return new Response(responseBody, {
      status: upstream.status,
      headers: {
        'content-type': contentType,
      },
    });
  } catch (error) {
    return Response.json(
      {
        error: 'Upstream unavailable',
        detail: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 502 },
    );
  }
}
