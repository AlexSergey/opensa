import type { Manifest } from '@opensa/loaders';

import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { Vfs } from './vfs';

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

/** A chunk zip with the given entries, matching how the build packs (bare names + loose paths). */
const chunk = (entries: Record<string, Uint8Array>): Uint8Array => zipSync(entries);

describe('Vfs', () => {
  describe('negative cases', () => {
    it('returns null/false for an absent file', () => {
      const vfs = new Vfs();
      expect(vfs.get('missing.dff')).toBeNull();
      expect(vfs.getText('missing.dat')).toBeNull();
      expect(vfs.has('missing')).toBe(false);
    });

    it('verify reports the gap when a chunk is missing', () => {
      const manifest: Manifest = {
        chunks: {
          data: [{ bytes: 1, cached: false, entries: 1, file: 'd.zip', hash: 'd' }],
          models: [{ bytes: 1, cached: true, entries: 1, file: 'm.zip', hash: 'm' }],
          others: [],
          textures: [],
        },
        game: 'test',
        version: 'test-1',
      };
      const vfs = new Vfs();
      vfs.addChunk('data', 'data-d.zip', chunk({ 'data/gta.dat': text('IPL') }));
      expect(vfs.verify(manifest)).toEqual(['expected 2 chunks, got 1', 'expected 2 entries, got 1']);
    });
  });

  describe('positive cases', () => {
    it('unzips a chunk and serves entries by name (bare + loose path)', () => {
      const vfs = new Vfs();
      vfs.addChunk('data', 'data-a.zip', chunk({ 'cj.dff': text('DFF'), 'data/gta.dat': text('IPL la.ipl') }));

      expect(vfs.has('cj.dff')).toBe(true);
      expect(new Uint8Array(vfs.get('cj.dff')!)).toEqual(text('DFF'));
      expect(vfs.getText('data/gta.dat')).toBe('IPL la.ipl');
      expect(vfs.names.sort()).toEqual(['cj.dff', 'data/gta.dat']);
    });

    it('merges entries across chunks and verifies a complete set', () => {
      const manifest: Manifest = {
        chunks: {
          data: [{ bytes: 1, cached: false, entries: 1, file: 'd.zip', hash: 'd' }],
          models: [{ bytes: 1, cached: true, entries: 1, file: 'm.zip', hash: 'm' }],
          others: [],
          textures: [{ bytes: 1, cached: true, entries: 1, file: 't.zip', hash: 't' }],
        },
        game: 'test',
        version: 'test-1',
      };
      const vfs = new Vfs();
      vfs.addChunk('data', 'd.zip', chunk({ 'data/gta.dat': text('dat') }));
      vfs.addChunk('models', 'm.zip', chunk({ 'cj.dff': text('dff') }));
      vfs.addChunk('textures', 't.zip', chunk({ 'cj.txd': text('txd') }));

      expect(vfs.names).toHaveLength(3);
      expect(vfs.verify(manifest)).toEqual([]);
    });

    it('ignores a re-delivered chunk (idempotent — retry/StrictMode safe)', () => {
      const manifest: Manifest = {
        chunks: {
          data: [{ bytes: 1, cached: false, entries: 1, file: 'd.zip', hash: 'd' }],
          models: [],
          others: [],
          textures: [],
        },
        game: 'test',
        version: 'test-1',
      };
      const vfs = new Vfs();
      const bytes = chunk({ 'data/gta.dat': text('dat') });
      vfs.addChunk('data', 'd.zip', bytes);
      vfs.addChunk('data', 'd.zip', bytes); // same chunk again → ignored
      expect(vfs.verify(manifest)).toEqual([]); // still 1 chunk / 1 entry
    });

    it('addFiles raw-ingests pre-unzipped entries and accounts like addChunk (idempotent)', () => {
      const manifest: Manifest = {
        chunks: {
          data: [],
          models: [{ bytes: 1, cached: false, entries: 1, file: 'local-models', hash: '' }],
          others: [],
          textures: [],
        },
        game: 'test',
        version: 'test-1',
      };
      const vfs = new Vfs();
      vfs.addFiles('local-models', [['cj.dff', text('DFF')]]);
      vfs.addFiles('local-models', [['cj.dff', text('DFF')]]); // same chunk id again → ignored

      expect(vfs.getText('cj.dff')).toBe('DFF');
      expect(vfs.verify(manifest)).toEqual([]); // 1 chunk / 1 entry
    });
  });
});
