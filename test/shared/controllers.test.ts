import { describe, expect, it } from 'vitest';
import { registeredControllers } from '../../src/main/controllers';
import { controllers, ipcChannels } from '../../src/shared/controllers';

describe('controller registry', () => {
  it('declares one metadata entry per controller id', () => {
    const ids = controllers.map((controller) => controller.id);

    expect(controllers).toHaveLength(24);
    expect(new Set(ids)).toHaveProperty('size', 24);
    expect(ids).toEqual([
      'auth-login',
      'password',
      'access-control',
      'audit',
      'session',
      'dashboard',
      'stock-alert',
      'expiration-alert',
      'daily-sales-total',
      'product-create',
      'product-edit',
      'product-status',
      'product-query',
      'lot',
      'waste',
      'sale',
      'stock-discount',
      'sales-history',
      'cash-closing',
      'cash-check',
      'worker',
      'shift',
      'attendance',
      'ean-reader',
    ]);
  });

  it('registers the same controllers in the main process', () => {
    expect(registeredControllers.map((controller) => controller.metadata.id)).toEqual(
      controllers.map((controller) => controller.id),
    );
  });

  it('assigns at least one IPC channel to every controller', () => {
    expect(ipcChannels.length).toBeGreaterThanOrEqual(24);
    expect(controllers.every((controller) => controller.channels.length > 0)).toBe(
      true,
    );
  });
});
