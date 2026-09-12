import React from 'react';
import { createRoot } from 'react-dom/client';
import { WorkerFormView } from '../../src/renderer/src/views/WorkerFormView';
import { WorkerListView } from '../../src/renderer/src/views/WorkerListView';
import { ShiftCreateView } from '../../src/renderer/src/views/ShiftCreateView';

window.calls = [];
window.appApi = {
  invoke: async (channel, payload) => {
    window.calls.push({ channel, payload });
    const response = await fetch('/__personal-ipc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel, payload }),
    });
    return response.json();
  },
};

const params = new URL(location.href).searchParams;
const view = params.get('view');
createRoot(document.getElementById('root')).render(view === 'shift'
  ? <ShiftCreateView currentPath="/app/personal/turnos/nuevo" usuarioId="11111111-1" onNavigate={() => undefined} />
  : view === 'list'
    ? <WorkerListView role={params.get('role') === 'trabajador' ? 'trabajador' : 'dueno'} usuarioId="11111111-1" onNavigate={() => undefined} />
    : <WorkerFormView usuarioId="11111111-1" onNavigate={() => undefined} />);
