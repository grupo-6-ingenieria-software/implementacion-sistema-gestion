import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CampoEAN13Input } from '../../src/renderer/src/components/CampoEAN13Input';
import { SaleRegisterView } from '../../src/renderer/src/views/SaleRegisterView';
import { ProductFormView } from '../../src/renderer/src/views/ProductFormView';
import { ProductListView } from '../../src/renderer/src/views/ProductListView';
import { ProductDeleteView } from '../../src/renderer/src/views/ProductDeleteView';
import { LotCreateView } from '../../src/renderer/src/views/LotCreateView';
import { WasteCreateView } from '../../src/renderer/src/views/WasteCreateView';
import { SupplierOrderCreateView } from '../../src/renderer/src/views/SupplierOrderCreateView';
import { StockAdjustmentView } from '../../src/renderer/src/views/StockAdjustmentView';
import { MovementHistoryView } from '../../src/renderer/src/views/MovementHistoryView';

const params = new URLSearchParams(location.search);
const props = { usuarioId: '12345678-9', role: 'dueno', onNavigate: () => undefined };
function InputHarness() {
  const [value, setValue] = useState(params.get('prefill') ?? '');
  const [submitted, setSubmitted] = useState(0);
  const [forms, setForms] = useState(0);
  return <form onSubmit={event => { event.preventDefault(); setForms(count => count + 1); }}>
    <label>Código<CampoEAN13Input value={value} onChange={setValue} modulo="ventas"
      captureMode="buscar-producto" disabled={params.has('disabled')}
      onValidSubmit={code => {
        window.submittedCodes.push(code);
        setSubmitted(count => count + 1);
        if (params.has('clear')) setValue('');
      }} /></label>
    <input aria-label="Otro campo" defaultValue="conservar" />
    <button type="submit">Confirmar formulario</button>
    <span data-testid="captures">{submitted}</span>
    <span data-testid="forms">{forms}</span>
  </form>;
}
const views = {
  input: <InputHarness />,
  sale: <SaleRegisterView session={{ ...props, trabajadorNombre: 'Ana', role: 'dueno' }} />,
  create: <ProductFormView {...props} mode="create" />,
  products: <ProductListView {...props} />,
  delete: <ProductDeleteView {...props} />,
  lot: <LotCreateView {...props} />,
  waste: <WasteCreateView {...props} />,
  order: <SupplierOrderCreateView {...props} />,
  adjustment: <StockAdjustmentView {...props} />,
  movements: <MovementHistoryView {...props} initialEan13={params.get('initialEan13') ?? undefined} />,
};
createRoot(document.getElementById('root')).render(views[params.get('view') ?? 'input']);
