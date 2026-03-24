// Local vendored wrapper around qrcode@1.5.4 browser implementation.
// This avoids external QR APIs and avoids npm-install issues in restricted environments.
// License file copied to src/lib/vendor/qrcode-lib-LICENSE.txt.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const browserQr = require('./qrcode-lib/browser');

type QrOptions = {
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' | 'low' | 'medium' | 'quartile' | 'high';
  margin?: number;
  width?: number;
  scale?: number;
  color?: {
    dark?: string;
    light?: string;
  };
};

export function toQrDataUrl(text: string, options?: QrOptions): Promise<string> {
  return browserQr.toDataURL(text, options);
}
