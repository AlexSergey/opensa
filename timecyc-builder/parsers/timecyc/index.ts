import { readFile } from 'node:fs/promises';

import { TimecycParsed } from '../../interfaces/timecyc.interface';
import { properties, time, weather } from './timecyc.constants';

export class TimecycParser {
  private _parsed: TimecycParsed = {};
  private _timecycData = '';

  getParsed(): TimecycParsed {
    return this._parsed;
  }

  parse(): this {
    const lines = this._timecycData.split('\n');

    const allProps = properties.reduce((a, b) => {
      a = a + b.numbers;

      return a;
    }, 0);

    weather.forEach((w) => {
      this._parsed[w] = {};
      time.forEach((t) => {
        this._parsed[w][t] = {};
        properties.forEach((p) => {
          this._parsed[w][t][p.name] = [];
        });
      });
    });

    let counterZone = 0;
    let counterTime = 0;

    for (const line of lines) {
      if (line.length === 0) {
        continue;
      }
      if (line.startsWith('/')) {
        continue;
      }
      const zone = weather[counterZone];

      const lineClean = line
        .replace(/\s+/g, ' ')
        .split(' ')
        .filter((p) => p !== '');

      if (lineClean.length === allProps) {
        properties.forEach((p) => {
          this._parsed[zone][`${counterTime}h`][p.name] = lineClean.splice(0, p.numbers);
        });
      } else {
        console.warn(`Wrong count for props: ${counterTime}h, ${zone}, ${line}`);
      }

      counterTime++;
      if (counterTime === 24) {
        counterTime = 0;
        counterZone++;
      }
    }

    return this;
  }

  async read(pth: string): Promise<this> {
    this._timecycData = await readFile(pth, 'utf8');

    return this;
  }

  setParsed(parsed: TimecycParsed): void {
    this._parsed = parsed;
  }

  stringify(): string | undefined {
    if (Object.keys(this._parsed).length === 0) {
      console.error('Need to parse first');

      return;
    }
    let res = '';
    const header = properties.reduce((a, b) => a + b.name + ' ', '//');

    Object.keys(this._parsed).forEach((w: string) => {
      res += `\n// ${w}\n`;
      res += `\n${header}`;
      Object.keys(this._parsed[w]).forEach((t: string) => {
        res += `\n// ${t}\n`;
        let prop = '';
        Object.keys(this._parsed[w][t]).forEach((p: string) => {
          try {
            prop += this._parsed[w][t][p].join(' ') + ' ';
          } catch (e) {
            console.error(e);
          }
        });
        res += prop;
      });
    });

    return res;
  }
}
