import { describe, expect, it } from 'vitest';

import { allChunks, chunkUrl, chunkUrls, manifestDir, parseManifest } from './manifest';

const valid = {
  chunks: {
    models: [{ bytes: 200, entries: 5, file: 'models-bbbb.zip', hash: 'bbbb' }],
    priority: [{ bytes: 100, entries: 3, file: 'priority-aaaa.zip', hash: 'aaaa' }],
    textures: [
      { bytes: 300, entries: 7, file: 'textures-cccc.zip', hash: 'cccc' },
      { bytes: 400, entries: 9, file: 'textures-dddd.zip', hash: 'dddd' },
    ],
  },
  game: 'original',
  version: 'original-0.1.0',
};

describe('parseManifest', () => {
  describe('negative cases', () => {
    it('throws when the manifest is not an object', () => {
      expect(() => parseManifest(null)).toThrow('not an object');
      expect(() => parseManifest('nope')).toThrow('not an object');
    });

    it('throws when game/version are missing', () => {
      expect(() => parseManifest({ chunks: {} })).toThrow('game/version');
    });

    it('throws when a group is not an array', () => {
      const broken = { ...valid, chunks: { ...valid.chunks, models: 'x' } };
      expect(() => parseManifest(broken)).toThrow('chunks.models is not an array');
    });

    it('throws when a chunk has invalid fields', () => {
      const broken = {
        ...valid,
        chunks: { ...valid.chunks, priority: [{ bytes: '100', entries: 3, file: 'p.zip', hash: 'a' }] },
      };
      expect(() => parseManifest(broken)).toThrow('chunks.priority[0] has invalid fields');
    });
  });

  describe('positive cases', () => {
    it('parses a well-formed manifest', () => {
      const manifest = parseManifest(valid);
      expect(manifest.game).toBe('original');
      expect(manifest.version).toBe('original-0.1.0');
      expect(manifest.chunks.textures).toHaveLength(2);
    });
  });
});

describe('manifestDir', () => {
  describe('positive cases', () => {
    it('strips the file name to leave the directory', () => {
      expect(manifestDir('http://host/original-0.1.0/manifest.json')).toBe('http://host/original-0.1.0');
    });
  });
});

describe('chunkUrl', () => {
  describe('positive cases', () => {
    it('joins the directory and chunk file, tolerating a trailing slash', () => {
      const info = { bytes: 1, entries: 1, file: 'textures-cccc.zip', hash: 'cccc' };
      expect(chunkUrl('http://host/v', info)).toBe('http://host/v/textures-cccc.zip');
      expect(chunkUrl('http://host/v/', info)).toBe('http://host/v/textures-cccc.zip');
    });
  });
});

describe('allChunks', () => {
  describe('positive cases', () => {
    it('flattens every chunk in priority → models → textures order, tagged by group', () => {
      const chunks = allChunks(parseManifest(valid));
      expect(chunks.map((c) => c.group)).toEqual(['priority', 'models', 'textures', 'textures']);
      expect(chunks.map((c) => c.file)).toEqual([
        'priority-aaaa.zip',
        'models-bbbb.zip',
        'textures-cccc.zip',
        'textures-dddd.zip',
      ]);
    });
  });
});

describe('chunkUrls', () => {
  describe('positive cases', () => {
    it('builds every chunk URL under the given directory', () => {
      expect(chunkUrls(parseManifest(valid), 'http://host/v')).toEqual([
        'http://host/v/priority-aaaa.zip',
        'http://host/v/models-bbbb.zip',
        'http://host/v/textures-cccc.zip',
        'http://host/v/textures-dddd.zip',
      ]);
    });
  });
});
