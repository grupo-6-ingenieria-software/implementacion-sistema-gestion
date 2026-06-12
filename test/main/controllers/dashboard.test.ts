import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/db/client', () => ({
  db: {
    all: vi.fn(),
  },
}));

import { dashboardController } from '../../../src/main/controllers/dashboard';

describe('dashboard controller', () => {
  it('rejects requests without a supported development role', async () => {
    await expect(
      dashboardController.handle({}, { channel: 'dashboard:cargar' }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'INVALID_REQUEST',
        controllerId: 'dashboard',
        message: 'Se requiere un rol valido para cargar el dashboard.',
      },
    });
  });
});
