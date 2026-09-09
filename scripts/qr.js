import QRCode from 'qrcode';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
function option(name) { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; }
try {
  const base = new URL(process.env.PUBLIC_BASE_URL || '');
  const host = base.hostname.toLowerCase();
  const confirmed = option('--confirm-host');
  const blocked = /(^|[.-])(localhost|local|test|invalid|example|preview|staging|dev|temporary|temp)([.-]|$)|ngrok|trycloudflare|localhost\.run|loca\.lt|localtunnel|serveo/i;
  if (base.protocol !== 'https:' || base.username || base.password || base.port || base.pathname !== '/' || base.search || base.hash || !host.includes('.') || blocked.test(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) {
    throw new Error('PUBLIC_BASE_URL must be the final HTTPS origin, without a port, path, credentials, or temporary/preview hostname.');
  }
  if (confirmed !== host) throw new Error('Pass --confirm-host with the exact production hostname after checking the final public URL.');
  const slug = option('--quest') || 'as-above-so-below';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('Quest slug must contain lowercase letters, digits, and single hyphens.');
  const output = path.resolve(option('--output') || 'work/qr');
  await mkdir(output, { recursive: true });
  const url = new URL(`/start/${slug}`, base).href;
  await QRCode.toFile(path.join(output, `${slug}.png`), url, { width: 1200, margin: 4, errorCorrectionLevel: 'H' });
  await writeFile(path.join(output, `${slug}.svg`), await QRCode.toString(url, { type: 'svg', margin: 4, errorCorrectionLevel: 'H' }));
  await writeFile(path.join(output, `${slug}.txt`), `${url}\n`);
  console.log(`QR generated for ${url}\nSaved PNG, SVG, and URL text to ${output}. Scan the printed proof before production printing.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
