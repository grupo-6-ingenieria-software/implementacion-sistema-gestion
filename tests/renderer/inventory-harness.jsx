import React from 'react';
import { createRoot } from 'react-dom/client';
import { ProductFormView } from '../../src/renderer/src/views/ProductFormView';
import { LotCreateView } from '../../src/renderer/src/views/LotCreateView';
import { WasteCreateView } from '../../src/renderer/src/views/WasteCreateView';

window.calls = [];
window.appApi = {
  invoke: async (channel, payload) => {
    window.calls.push({ channel, payload });
    const response = await fetch('/__inventory-ipc', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel, payload }),
    });
    return response.json();
  },
};

function Harness() {
  return <main>
    <section data-testid="product"><ProductFormView mode="create" usuarioId="12345678-9" onNavigate={() => undefined} /></section>
    <section data-testid="lot"><LotCreateView usuarioId="12345678-9" onNavigate={() => undefined} /></section>
    <section data-testid="waste"><WasteCreateView usuarioId="12345678-9" onNavigate={() => undefined} /></section>
  </main>;
}

createRoot(document.getElementById('root')).render(<Harness />);
