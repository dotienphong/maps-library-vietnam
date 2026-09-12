#!/usr/bin/env node
// Sinh src/expo/silence-audio.ts: 1 giây im lặng thật (PCM 16-bit toàn số 0) đóng gói WAV, nhúng
// base64. Phát lặp liên tục khi dẫn đường để giữ AVAudioSession "đang phát" trên iOS — thiếu dòng
// âm thanh thật chảy qua, hệ điều hành thu hồi quyền chạy nền giữa hai câu chỉ dẫn (khoảng cách vài
// chục giây), im lặng hoàn toàn khi khoá màn hình dù đã setIsAudioActiveAsync(true) (spec C mục 11,
// rủi ro 1; xác nhận bằng thực địa iPhone thật 12/09/2026). Chạy: node packages/react-native/scripts/gen-silence.mjs
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 8000;
const CHANNELS = 1;
const BITS = 16;
const SECONDS = 1;
const byteRate = (SAMPLE_RATE * CHANNELS * BITS) / 8;
const blockAlign = (CHANNELS * BITS) / 8;
const dataSize = SAMPLE_RATE * SECONDS * blockAlign; // toàn số 0 = im lặng tuyệt đối

const header = Buffer.alloc(44);
header.write('RIFF', 0, 'ascii');
header.writeUInt32LE(36 + dataSize, 4);
header.write('WAVE', 8, 'ascii');
header.write('fmt ', 12, 'ascii');
header.writeUInt32LE(16, 16); // kích cỡ sub-chunk fmt
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(CHANNELS, 22);
header.writeUInt32LE(SAMPLE_RATE, 24);
header.writeUInt32LE(byteRate, 28);
header.writeUInt16LE(blockAlign, 32);
header.writeUInt16LE(BITS, 34);
header.write('data', 36, 'ascii');
header.writeUInt32LE(dataSize, 40);

const wav = Buffer.concat([header, Buffer.alloc(dataSize)]); // Buffer.alloc mặc định toàn 0

const out = `// Sinh bởi scripts/gen-silence.mjs — KHÔNG sửa tay; chạy lại script nếu đổi thời lượng.
/** WAV ${SECONDS} giây, ${SAMPLE_RATE} Hz mono 16-bit, toàn mẫu 0 (im lặng tuyệt đối). */
export const SILENT_AUDIO_DATA_URI =
  'data:audio/wav;base64,${wav.toString('base64')}';
`;
const target = resolve(dirname(fileURLToPath(import.meta.url)), '../src/expo/silence-audio.ts');
writeFileSync(target, out);
console.log(`✓ ${target} (${wav.length} byte WAV, ${SECONDS}s @ ${SAMPLE_RATE} Hz)`);
