import type { TimecycParser } from '../parsers/timecyc';

export interface TimecycItem {
  path: string;
  props?: string[];
  skipProps?: boolean;
  timecyc?: TimecycParser;
  times?: string[];
  zones?: string[];
}

export type TimecycParsed = Record<string, Record<string, Record<string, string[]>>>;
