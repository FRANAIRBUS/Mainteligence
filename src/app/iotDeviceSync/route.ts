import { proxyIotFunction } from '@/lib/iot-function-proxy';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  return proxyIotFunction(request, 'iotDeviceSync');
}
