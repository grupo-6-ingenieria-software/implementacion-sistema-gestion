import { describe, expect, it, vi } from 'vitest';
import { DASHBOARD_UPDATED_EVENT } from '../../../src/shared/dashboard';

const { send, getAllWindows } = vi.hoisted(() => {
  const sendMock = vi.fn();

  return {
    send: sendMock,
    getAllWindows: vi.fn(() => [{ webContents: { send: sendMock } }]),
  };
});

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows,
  },
}));

import { notifyDashboardUpdated } from '../../../src/main/controllers/dashboard-events';

describe('dashboard update events', () => {
  it('emits the dashboard update event to every open window', () => {
    notifyDashboardUpdated();

    expect(getAllWindows).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(DASHBOARD_UPDATED_EVENT);
  });
});
