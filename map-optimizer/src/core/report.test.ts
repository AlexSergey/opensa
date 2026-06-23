import { describe, expect, it } from 'vitest';

import type { AssetReport, RunReport } from './report';

import { summarizeReport } from './report';

function asset(overrides: Partial<AssetReport>): AssetReport {
  return {
    applied: [],
    bytesAfter: 0,
    bytesBefore: 0,
    dirty: false,
    name: 'm',
    trianglesAfter: 0,
    trianglesBefore: 0,
    verticesAfter: 0,
    verticesBefore: 0,
    ...overrides,
  };
}

describe('summarizeReport', () => {
  describe('positive cases', () => {
    it('aggregates models, changes, removals, bytes and failures', () => {
      const report: RunReport = {
        assets: [
          asset({
            bytesAfter: 80,
            bytesBefore: 100,
            dirty: true,
            trianglesAfter: 8,
            trianglesBefore: 10,
            verticesAfter: 15,
            verticesBefore: 20,
          }),
          asset({ bytesAfter: 50, bytesBefore: 50, dirty: false, verticesAfter: 5, verticesBefore: 5 }),
        ],
        failures: [{ error: 'x', name: 'bad' }],
        game: 'g',
        outDir: '/out',
      };

      expect(summarizeReport(report)).toEqual({
        bytesAfter: 130,
        bytesBefore: 150,
        changed: 1,
        failures: 1,
        models: 2,
        trianglesRemoved: 2,
        verticesRemoved: 5,
      });
    });
  });
});
