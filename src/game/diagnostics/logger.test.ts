import { describe, expect, it, vi } from 'vitest';

import type { LogLevel } from '../interfaces/config.interface';

import { type LogEntry, Logger } from './logger';

function setup(showLogs: false | LogLevel): { emit: ReturnType<typeof vi.fn>; logger: Logger } {
  const emit = vi.fn();
  const logger = new Logger({ emit }, { showLogs });

  return { emit, logger };
}

describe('Logger', () => {
  describe('negative cases', () => {
    it('stays silent when showLogs is false', () => {
      const { emit, logger } = setup(false);
      logger.error('damage', 'boom');
      expect(emit).not.toHaveBeenCalled();
    });

    it('suppresses entries below the configured floor', () => {
      const { emit, logger } = setup('warn');
      logger.debug('vehicle', 'noise');
      logger.log('vehicle', 'noise');
      expect(emit).not.toHaveBeenCalled();
    });
  });

  describe('positive cases', () => {
    it('emits entries at or above the floor with level, type, message and data', () => {
      const { emit, logger } = setup('log');
      logger.warn('enter-vehicle', 'seated', { id: 7 });
      expect(emit).toHaveBeenCalledWith('log', {
        data: { id: 7 },
        level: 'warn',
        message: 'seated',
        type: 'enter-vehicle',
      } satisfies LogEntry);
    });

    it('emits at the floor level itself', () => {
      const { emit, logger } = setup('debug');
      logger.debug('physics', 'step');
      expect(emit).toHaveBeenCalledOnce();
    });
  });
});
