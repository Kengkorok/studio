// Video: tukar ke MP4 H.264 (sisi panjang maks 1280px), buang metadata, dan ambil gambar poster.
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { toWebp } from './images.js';

const MAX_SAAT = 10 * 60;
const MAX_OUT = 45 * 1024 * 1024; // GitHub tolak fail > 100MB; repo laman patut kekal kecil
const ralat = (msg) => Object.assign(new Error(msg), { status: 400 });

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    let err = '';
    p.stdout.on('data', (b) => out.push(b));
    p.stderr.on('data', (b) => { err = (err + b).slice(-2000); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`${cmd} ${code}: ${err.trim()}`))));
  });
}

async function probe(file) {
  const out = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file]);
  const info = JSON.parse(out);
  const s = info.streams?.[0];
  return s && { width: s.width, height: s.height, duration: Number(info.format?.duration) || 0 };
}

export async function toMp4(input, output) {
  const info = await probe(input).catch(() => null);
  if (!info) throw ralat('Fail bukan video yang boleh dibaca.');
  if (info.duration > MAX_SAAT) throw ralat(`Video lebih ${MAX_SAAT / 60} minit. Guna YouTube untuk video panjang.`);

  await run('ffmpeg', [
    '-v', 'error', '-y', '-i', input,
    '-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '-1', '-map_chapters', '-1', // buang lokasi GPS dan metadata lain
    '-vf', "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-maxrate', '2500k', '-bufsize', '5000k', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k', '-ac', '2',
    '-movflags', '+faststart', // boleh mula main sebelum habis dimuat turun
    output,
  ]);

  const { size } = await stat(output);
  if (size > MAX_OUT) {
    throw ralat(`Video masih ${Math.round(size / 1048576)} MB selepas dikecilkan (had ${MAX_OUT / 1048576} MB). Potong lebih pendek atau guna YouTube.`);
  }
  const { width, height } = await probe(output);
  const frame = await run('ffmpeg', ['-v', 'error', '-i', output, '-vf', 'thumbnail', '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', '-']);
  return { width, height, size, poster: await toWebp(frame) };
}
