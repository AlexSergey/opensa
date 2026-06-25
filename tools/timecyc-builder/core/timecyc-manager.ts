import { ensure24h, parseTimecyc, stringifyTimecyc } from '@opensa/renderware/parsers/text/timecyc.parser';
import { readFile } from 'node:fs/promises';

import type { TimecycItem } from '../interfaces/timecyc.interface';

import { type MergeItem, mergeTimecyc } from './merge';

export class TimecycManager {
  private base: number[][] = [];
  private readonly items: MergeItem[] = [];

  /** Merge every loaded item onto the base and serialise to SA timecyc `.dat` text. */
  merge(): string {
    if (this.base.length === 0) {
      throw new Error('timecyc-builder: base timecyc not set (call setBase first)');
    }

    return stringifyTimecyc(mergeTimecyc(this.base, this.items));
  }

  async setBase(path: string): Promise<void> {
    this.base = await readRows(path);
  }

  async setTimecycToMerge(list: readonly TimecycItem[]): Promise<this> {
    for (const { path, ...filters } of list) {
      this.items.push({ ...filters, rows: await readRows(path) });
    }

    return this;
  }
}

/** Read a timecyc file and normalise it to 24h — vanilla 8-keyframe inputs are converted, already-24h
 *  files pass through (so base and merge sources can each be either format; the output is always 24h). */
async function readRows(path: string): Promise<number[][]> {
  return ensure24h(parseTimecyc(await readFile(path, 'utf8')));
}
