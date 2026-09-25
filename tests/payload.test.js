// ============================================================================
// tests/payload.test.js —— 明文载荷二进制契约测试
//   payload.js 是构建侧（main/encryptFlow）与解析侧（decrypt）的唯一归属，
//   这里锁死「构建 → 解析」的往返行为，防止格式在重构中被改坏。
// ============================================================================
import { describe, it, expect } from 'vitest';
import { buildBatchPayload, parseBatchPayload, parseSinglePayload } from '../src/payload.js';
import { concatBuffers } from '../src/crypto.js';

const enc = new TextEncoder();

function bytes(buf) { return new Uint8Array(buf); }

function fileOf(name, mime, text) {
  return { name, mime, dataBuffer: enc.encode(text).buffer };
}

describe('payload 载荷契约 · 批量容器', () => {
  it('构建→解析往返一致（多文件、中文名、二进制数据）', () => {
    const files = [
      fileOf('笔记.txt', 'text/plain', '你好，世界'),
      { name: '图.png', mime: 'image/png', dataBuffer: new Uint8Array([0, 1, 2, 255, 128]).buffer },
    ];
    const buf = buildBatchPayload(files);
    const parsed = parseBatchPayload(buf);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe('笔记.txt');
    expect(parsed[0].mime).toBe('text/plain');
    expect(new TextDecoder().decode(parsed[0].dataBuffer)).toBe('你好，世界');
    expect(parsed[1].name).toBe('图.png');
    expect(Array.from(bytes(parsed[1].dataBuffer))).toEqual([0, 1, 2, 255, 128]);
  });

  it('空文件列表也按 count=0 构建并解析', () => {
    const parsed = parseBatchPayload(buildBatchPayload([]));
    expect(parsed).toEqual([]);
  });

  it('非批量数据（无 MULT 魔数）返回 null，交由单文件解析兜底', () => {
    expect(parseBatchPayload(enc.encode('随便的内容').buffer)).toBeNull();
    expect(parseBatchPayload(new ArrayBuffer(0))).toBeNull();
  });

  it('批量版本号不受支持时抛中文错误', () => {
    const u = bytes(buildBatchPayload([fileOf('a.txt', 'text/plain', 'x')]));
    u[4] = 9; // 第 5 字节是版本号
    expect(() => parseBatchPayload(u.buffer)).toThrow('批量版本不支持');
  });
});

describe('payload 载荷契约 · 单文件容器', () => {
  it('构建→解析往返一致（mime + 32 字节哈希 + 压缩段）', () => {
    const mimeBytes = enc.encode('text/html');
    const mimeLen = new Uint8Array(2);
    new DataView(mimeLen.buffer).setUint16(0, mimeBytes.length, false);
    const hash = new Uint8Array(32).fill(0xab);
    const compressed = enc.encode('压缩后的正文');
    const buf = concatBuffers([mimeLen.buffer, mimeBytes.buffer, hash.buffer, compressed.buffer]);

    const r = parseSinglePayload(buf);
    expect(r.mimeType).toBe('text/html');
    expect(Array.from(r.expectedHash)).toEqual(Array.from(hash));
    expect(new TextDecoder().decode(r.compressedData)).toBe('压缩后的正文');
  });
});
