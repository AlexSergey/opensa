import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import type { Manifest } from '../loaders';

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
          models: [{ bytes: 1, entries: 1, file: 'm.zip', hash: 'm' }],
          priority: [{ bytes: 1, entries: 1, file: 'p.zip', hash: 'p' }],
          textures: [],
        },
        game: 'test',
        version: 'test-1',
      };
      const vfs = new Vfs();
      vfs.addChunk('priority', 'priority-p.zip', chunk({ 'data/gta.dat': text('IPL') }));
      expect(vfs.verify(manifest)).toEqual(['expected 2 chunks, got 1', 'expected 2 entries, got 1']);
    });
  });

  describe('positive cases', () => {
    it('unzips a chunk and serves entries by name (bare + loose path)', () => {
      const vfs = new Vfs();
      vfs.addChunk('priority', 'priority-a.zip', chunk({ 'cj.dff': text('DFF'), 'data/gta.dat': text('IPL la.ipl') }));

      expect(vfs.has('cj.dff')).toBe(true);
      expect(new Uint8Array(vfs.get('cj.dff')!)).toEqual(text('DFF'));
      expect(vfs.getText('data/gta.dat')).toBe('IPL la.ipl');
      expect(vfs.names.sort()).toEqual(['cj.dff', 'data/gta.dat']);
    });

    it('merges entries across chunks and verifies a complete set', () => {
      const manifest: Manifest = {
        chunks: {
          models: [{ bytes: 1, entries: 1, file: 'm.zip', hash: 'm' }],
          priority: [{ bytes: 1, entries: 1, file: 'p.zip', hash: 'p' }],
          textures: [{ bytes: 1, entries: 1, file: 't.zip', hash: 't' }],
        },
        game: 'test',
        version: 'test-1',
      };
      const vfs = new Vfs();
      vfs.addChunk('priority', 'p.zip', chunk({ 'data/gta.dat': text('dat') }));
      vfs.addChunk('models', 'm.zip', chunk({ 'cj.dff': text('dff') }));
      vfs.addChunk('textures', 't.zip', chunk({ 'cj.txd': text('txd') }));

      expect(vfs.names).toHaveLength(3);
      expect(vfs.verify(manifest)).toEqual([]);
    });

    it('ignores a re-delivered chunk (idempotent — retry/StrictMode safe)', () => {
      const manifest: Manifest = {
        chunks: {
          models: [],
          priority: [{ bytes: 1, entries: 1, file: 'p.zip', hash: 'p' }],
          textures: [],
        },
        game: 'test',
        version: 'test-1',
      };
      const vfs = new Vfs();
      const bytes = chunk({ 'data/gta.dat': text('dat') });
      vfs.addChunk('priority', 'p.zip', bytes);
      vfs.addChunk('priority', 'p.zip', bytes); // same chunk again → ignored
      expect(vfs.verify(manifest)).toEqual([]); // still 1 chunk / 1 entry
    });

    it('addFiles raw-ingests pre-unzipped entries and accounts like addChunk (idempotent)', () => {
      const manifest: Manifest = {
        chunks: {
          models: [{ bytes: 1, entries: 1, file: 'local-models', hash: '' }],
          priority: [],
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
