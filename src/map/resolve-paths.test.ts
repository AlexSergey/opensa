import { describe, expect, it } from 'vitest';

import { datChildUrl, imgAssetUrl, iplBasename, normalizeDatPath, streamIplUrl } from './resolve-paths';

describe('normalizeDatPath', () => {
  it('converts backslashes to slashes and lowercases', () => {
    expect(normalizeDatPath('DATA\\MAPS\\basic\\basicmap.IDE')).toBe('data/maps/basic/basicmap.ide');
  });

  it('drops leading slashes', () => {
    expect(normalizeDatPath('\\IMG\\basicmap')).toBe('img/basicmap');
  });
});

describe('datChildUrl', () => {
  it('joins the base with a normalized dat path', () => {
    expect(datChildUrl('http://x:3001', 'DATA\\MAPS\\basic\\basicmap.IPL')).toBe(
      'http://x:3001/data/maps/basic/basicmap.ipl',
    );
  });

  it('avoids double slashes when the base has a trailing slash', () => {
    expect(datChildUrl('http://x:3001/', 'DATA\\a.ide')).toBe('http://x:3001/data/a.ide');
  });
});

describe('imgAssetUrl', () => {
  it('builds an asset url inside an IMG folder', () => {
    expect(imgAssetUrl('http://x:3001', 'IMG\\basicmap', 'gplane', 'dff')).toBe(
      'http://x:3001/img/basicmap/gplane.dff',
    );
    expect(imgAssetUrl('http://x:3001', 'img/basicmap', 'basicmain', 'TXD')).toBe(
      'http://x:3001/img/basicmap/basicmain.txd',
    );
  });
});

describe('iplBasename', () => {
  it('extracts the lowercased base name without path or extension', () => {
    expect(iplBasename('DATA\\MAPS\\LA\\LAe.IPL')).toBe('lae');
    expect(iplBasename('data/maps/la/lan2.ipl')).toBe('lan2');
  });
});

describe('streamIplUrl', () => {
  it('builds the Nth binary stream url under ipl_binary/', () => {
    expect(streamIplUrl('http://x:3001', 'lae', 0)).toBe('http://x:3001/ipl_binary/lae_stream0.ipl');
    expect(streamIplUrl('http://x:3001/', 'law2', 3)).toBe('http://x:3001/ipl_binary/law2_stream3.ipl');
  });
});
