import { useEffect, useState, type ReactElement } from "react";
import {
  supplierOrderStateLabels,
  type SupplierOrderDetail,
  type SupplierOrderFieldErrors,
  type SupplierOrderFinishResponse,
  type SupplierOrderListFilter,
  type SupplierOrderListItem,
  type SupplierOrderReceptionResponse,
} from "../../../shared/supplier-orders";

type SupplierOrderReceptionViewProps = {
  usuarioId: string;
  onNavigate: (path: string) => void;
};

type ReceiptDraftLine = {
  cantidad: string;
  fechaVencimiento: string;
  precioCosto: string;
};

export function SupplierOrderReceptionView({
  usuarioId,
  onNavigate,
}: SupplierOrderReceptionViewProps): ReactElement {
  const [filter, setFilter] = useState<SupplierOrderListFilter>("abiertos");
  const [orders, setOrders] = useState<SupplierOrderListItem[]>([]);
  const [selected, setSelected] = useState<SupplierOrderDetail | null>(null);
  const [draft, setDraft] = useState<Record<string, ReceiptDraftLine>>({});
  const [operationId, setOperationId] = useState(createOperationId);
  const [closeReason, setCloseReason] = useState("");
  const [errors, setErrors] = useState<SupplierOrderFieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  async function loadOrders(nextFilter = filter): Promise<void> {
    setLoading(true);
    try {
      const response = await window.appApi.invoke<SupplierOrderListItem[]>(
        "pedido:listar",
        { estado: nextFilter, usuarioId },
      );
      if (!response.ok) {
        setOrders([]);
        setMessage(response.error.message);
        return;
      }
      setOrders(response.data);
    } catch {
      setOrders([]);
      setMessage("No fue posible cargar los pedidos.");
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(pedidoId: string): Promise<void> {
    setWorking(true);
    setErrors({});
    try {
      const response = await window.appApi.invoke<SupplierOrderDetail>(
        "pedido:detalle",
        { pedidoId, usuarioId },
      );
      if (!response.ok) {
        setMessage(response.error.message);
        return;
      }
      setSelected(response.data);
      setDraft(
        Object.fromEntries(
          response.data.lineas.map((line) => [
            line.detallePedidoId,
            { cantidad: "0", fechaVencimiento: "", precioCosto: "" },
          ]),
        ),
      );
      setOperationId(createOperationId());
      setCloseReason("");
    } catch {
      setMessage("No fue posible cargar el detalle del pedido.");
    } finally {
      setWorking(false);
    }
  }

  useEffect(() => {
    void loadOrders(filter);
  }, [filter, usuarioId]);

  useEffect(
    () =>
      window.appApi.onSupplierOrdersUpdated(() => {
        void loadOrders(filter);
        if (selected) void loadDetail(selected.pedidoId);
      }),
    [filter, selected?.pedidoId, usuarioId],
  );

  function updateDraft(
    detailId: string,
    field: keyof ReceiptDraftLine,
    value: string,
  ): void {
    setDraft((current) => ({
      ...current,
      [detailId]: { ...current[detailId], [field]: value },
    }));
  }

  function fillPending(): void {
    if (!selected) return;
    setDraft((current) =>
      Object.fromEntries(
        selected.lineas.map((line) => [
          line.detallePedidoId,
          {
            ...current[line.detallePedidoId],
            cantidad: String(line.cantidadPendiente),
          },
        ]),
      ),
    );
  }

  function clearDelivery(): void {
    if (!selected) return;
    setDraft(
      Object.fromEntries(
        selected.lineas.map((line) => [
          line.detallePedidoId,
          { cantidad: "0", fechaVencimiento: "", precioCosto: "" },
        ]),
      ),
    );
    setErrors({});
  }

  async function submitReception(): Promise<void> {
    if (!selected) return;
    setWorking(true);
    setErrors({});
    setMessage(null);
    try {
      const response = await window.appApi.invoke<SupplierOrderReceptionResponse>(
        "pedido:confirmar-recepcion",
        {
          pedidoId: selected.pedidoId,
          operacionId: operationId,
          lineas: selected.lineas.map((line) => ({
            detallePedidoId: line.detallePedidoId,
            cantidad: Number(draft[line.detallePedidoId]?.cantidad ?? 0),
            precioCosto: Number(
              draft[line.detallePedidoId]?.precioCosto ?? Number.NaN,
            ),
            fechaVencimiento:
              draft[line.detallePedidoId]?.fechaVencimiento || undefined,
          })),
          usuarioId,
        },
      );
      if (!response.ok) {
        setErrors(response.error.fieldErrors ?? {});
        setMessage(response.error.message);
        return;
      }

      setMessage(
        response.data.idempotente
          ? "La recepción ya había sido registrada; no se duplicaron lotes ni cantidades."
          : `Recepción registrada. Estado: ${supplierOrderStateLabels[response.data.estado]}.`,
      );
      setOperationId(createOperationId());
      await Promise.all([loadOrders(filter), loadDetail(selected.pedidoId)]);
    } catch {
      setMessage(
        "No fue posible confirmar la recepción. Puede reintentar sin duplicarla.",
      );
    } finally {
      setWorking(false);
    }
  }

  async function cancelOrder(): Promise<void> {
    if (!selected) return;
    if (
      !window.confirm(
        "¿Cancelar este pedido? No se crearán lotes ni movimientos de stock.",
      )
    ) {
      return;
    }
    await finishOrder("pedido:cancelar", {
      pedidoId: selected.pedidoId,
      confirmacion: true,
      usuarioId,
    });
  }

  async function closeBalance(): Promise<void> {
    if (!selected) return;
    if (!closeReason.trim()) {
      setErrors({ motivo: "Ingrese el motivo del cierre de saldo." });
      return;
    }
    if (
      !window.confirm(
        "¿Cerrar el saldo pendiente? Se conservarán cantidades, lotes e historial y no cambiará el stock.",
      )
    ) {
      return;
    }
    await finishOrder("pedido:cerrar-saldo", {
      pedidoId: selected.pedidoId,
      confirmacion: true,
      motivo: closeReason,
      usuarioId,
    });
  }

  async function finishOrder(channel: string, payload: unknown): Promise<void> {
    setWorking(true);
    setErrors({});
    setMessage(null);
    try {
      const response = await window.appApi.invoke<SupplierOrderFinishResponse>(
        channel,
        payload,
      );
      if (!response.ok) {
        setErrors(response.error.fieldErrors ?? {});
        setMessage(response.error.message);
        return;
      }

      setMessage(
        `Pedido actualizado a ${supplierOrderStateLabels[response.data.estado]}.`,
      );
      await Promise.all([loadOrders(filter), loadDetail(response.data.pedidoId)]);
    } catch {
      setMessage("No fue posible actualizar el pedido. Intente nuevamente.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="px-8 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold text-[#17202a]">
            Pedidos, recepciones e historial
          </h3>
          <p className="mt-1 text-sm text-[#61717f]">
            Registre cada entrega por separado y consulte la trazabilidad.
          </p>
        </div>
        <button
          className="rounded-md bg-[#244d61] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1f4354]"
          type="button"
          onClick={() => onNavigate("/app/proveedores/pedidos/nuevo")}
        >
          Registrar pedido
        </button>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[380px_1fr]">
        <aside className="rounded-md border border-[#cbd5df] bg-white p-5 shadow-sm">
          <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
            Mostrar
            <select
              className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value as SupplierOrderListFilter);
                setSelected(null);
              }}
            >
              <option value="abiertos">Pendientes y parciales</option>
              <option value="terminados">Terminados</option>
              <option value="todos">Todos</option>
            </select>
          </label>

          <div className="mt-4 grid gap-3">
            {orders.map((order) => (
              <button
                className={`rounded-md border p-4 text-left transition hover:bg-[#f6f7f9] ${
                  selected?.pedidoId === order.pedidoId
                    ? "border-[#2d6a4f] bg-[#edf7f2]"
                    : "border-[#d7dee6]"
                }`}
                key={order.pedidoId}
                type="button"
                onClick={() => void loadDetail(order.pedidoId)}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="font-semibold text-[#17202a]">
                    {shortId(order.pedidoId)}
                  </span>
                  <Status state={order.estado} />
                </div>
                <p className="mt-2 text-sm font-semibold text-[#24313d]">
                  {order.proveedorNombre}
                </p>
                <p className="mt-1 text-xs text-[#61717f]">
                  Solicitado {order.totalSolicitado} · Recibido {order.totalRecibido} · Pendiente {order.totalPendiente}
                </p>
              </button>
            ))}
            {!loading && orders.length === 0 ? (
              <p className="py-6 text-center text-sm text-[#61717f]">
                No hay pedidos para este filtro.
              </p>
            ) : null}
            {loading ? (
              <p className="py-6 text-center text-sm text-[#61717f]">
                Cargando pedidos...
              </p>
            ) : null}
          </div>
        </aside>

        <main className="min-w-0 rounded-md border border-[#cbd5df] bg-white p-6 shadow-sm">
          {!selected ? (
            <p className="py-12 text-center text-sm text-[#61717f]">
              Seleccione un pedido para ver su detalle e historial.
            </p>
          ) : (
            <OrderDetail
              closeReason={closeReason}
              draft={draft}
              errors={errors}
              order={selected}
              working={working}
              onCancel={() => void cancelOrder()}
              onClear={clearDelivery}
              onClose={() => void closeBalance()}
              onCloseReason={setCloseReason}
              onFillPending={fillPending}
              onSubmit={() => void submitReception()}
              onUpdateDraft={updateDraft}
            />
          )}
          {message ? (
            <p className="mt-4 rounded-md bg-[#edf1f5] px-3 py-2 text-sm font-semibold text-[#24313d]">
              {message}
            </p>
          ) : null}
        </main>
      </div>
    </section>
  );
}

function OrderDetail({
  closeReason,
  draft,
  errors,
  order,
  working,
  onCancel,
  onClear,
  onClose,
  onCloseReason,
  onFillPending,
  onSubmit,
  onUpdateDraft,
}: {
  closeReason: string;
  draft: Record<string, ReceiptDraftLine>;
  errors: SupplierOrderFieldErrors;
  order: SupplierOrderDetail;
  working: boolean;
  onCancel: () => void;
  onClear: () => void;
  onClose: () => void;
  onCloseReason: (value: string) => void;
  onFillPending: () => void;
  onSubmit: () => void;
  onUpdateDraft: (
    id: string,
    field: keyof ReceiptDraftLine,
    value: string,
  ) => void;
}): ReactElement {
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-[#61717f]">
            Pedido {shortId(order.pedidoId)}
          </p>
          <h4 className="mt-1 text-lg font-semibold text-[#17202a]">
            {order.proveedorNombre}
          </h4>
          <p className="text-sm text-[#61717f]">RUT {order.proveedorRut}</p>
        </div>
        <Status state={order.estado} />
      </div>

      <div className="mt-5 overflow-x-auto rounded-md border border-[#d7dee6]">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-[#edf1f5] text-left text-[#24313d]">
            <tr>
              <th className="px-3 py-3">Producto</th>
              <th className="px-3 py-3">Solicitado</th>
              <th className="px-3 py-3">Recibido</th>
              <th className="px-3 py-3">Pendiente</th>
              {order.puedeRecibir ? <th className="px-3 py-3">Esta entrega</th> : null}
              {order.puedeRecibir ? <th className="px-3 py-3">Costo</th> : null}
              {order.puedeRecibir ? <th className="px-3 py-3">Vencimiento</th> : null}
            </tr>
          </thead>
          <tbody>
            {order.lineas.map((line, index) => {
              const lineDraft = draft[line.detallePedidoId] ?? {
                cantidad: "0",
                fechaVencimiento: "",
                precioCosto: "",
              };
              return (
                <tr className="border-t border-[#e3e8ee]" key={line.detallePedidoId}>
                  <td className="px-3 py-3">
                    <p className="font-semibold">{line.nombre}</p>
                    <p className="text-xs text-[#61717f]">{line.ean13}</p>
                  </td>
                  <td className="px-3 py-3">{line.cantidadSolicitada}</td>
                  <td className="px-3 py-3">{line.cantidadRecibida}</td>
                  <td className="px-3 py-3 font-semibold">{line.cantidadPendiente}</td>
                  {order.puedeRecibir ? (
                    <td className="min-w-36 px-3 py-3">
                      <input
                        className="w-24 rounded-md border border-[#9ba9b5] px-2 py-2"
                        max={line.cantidadPendiente}
                        min="0"
                        step="1"
                        type="number"
                        value={lineDraft.cantidad}
                        onChange={(event) =>
                          onUpdateDraft(line.detallePedidoId, "cantidad", event.target.value)
                        }
                      />
                      <LineError errors={errors} index={index} field="cantidad" />
                    </td>
                  ) : null}
                  {order.puedeRecibir ? (
                    <td className="min-w-36 px-3 py-3">
                      <input
                        className="w-28 rounded-md border border-[#9ba9b5] px-2 py-2"
                        min="1"
                        step="1"
                        type="number"
                        value={lineDraft.precioCosto}
                        onChange={(event) =>
                          onUpdateDraft(line.detallePedidoId, "precioCosto", event.target.value)
                        }
                      />
                      <LineError errors={errors} index={index} field="precioCosto" />
                    </td>
                  ) : null}
                  {order.puedeRecibir ? (
                    <td className="min-w-44 px-3 py-3">
                      {line.exigeVencimiento ? (
                        <input
                          className="rounded-md border border-[#9ba9b5] px-2 py-2"
                          type="date"
                          value={lineDraft.fechaVencimiento}
                          onChange={(event) =>
                            onUpdateDraft(
                              line.detallePedidoId,
                              "fechaVencimiento",
                              event.target.value,
                            )
                          }
                        />
                      ) : (
                        <span className="text-[#61717f]">No requerido</span>
                      )}
                      <LineError errors={errors} index={index} field="fechaVencimiento" />
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {errors.lineas ? <p className="mt-2 text-xs font-semibold text-[#9f2d20]">{errors.lineas}</p> : null}

      {order.puedeRecibir ? (
        <div className="mt-4 flex flex-wrap gap-3">
          <button className="rounded-md border border-[#9ba9b5] px-3 py-2 text-sm font-semibold" type="button" onClick={onFillPending}>
            Recibir saldo total
          </button>
          <button className="rounded-md border border-[#9ba9b5] px-3 py-2 text-sm font-semibold" type="button" onClick={onClear}>
            Limpiar entrega
          </button>
          <button className="rounded-md bg-[#2d6a4f] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba9b5]" disabled={working} type="button" onClick={onSubmit}>
            {working ? "Confirmando..." : "Confirmar recepción"}
          </button>
        </div>
      ) : null}

      {order.puedeCancelar ? (
        <div className="mt-5 border-t border-[#e3e8ee] pt-5">
          <button className="rounded-md border border-[#b42318] px-4 py-2 text-sm font-semibold text-[#9f2d20]" disabled={working} type="button" onClick={onCancel}>
            Cancelar pedido
          </button>
        </div>
      ) : null}

      {order.puedeCerrarSaldo ? (
        <div className="mt-5 grid gap-3 border-t border-[#e3e8ee] pt-5">
          <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
            Motivo para cerrar el saldo pendiente
            <textarea className="min-h-24 rounded-md border border-[#9ba9b5] px-3 py-2 font-normal" value={closeReason} onChange={(event) => onCloseReason(event.target.value)} />
          </label>
          {errors.motivo ? <p className="text-xs font-semibold text-[#9f2d20]">{errors.motivo}</p> : null}
          <button className="w-fit rounded-md border border-[#8a5a12] px-4 py-2 text-sm font-semibold text-[#7a4f10]" disabled={working} type="button" onClick={onClose}>
            Cerrar saldo pendiente
          </button>
        </div>
      ) : null}

      <ReceptionHistory order={order} />
    </div>
  );
}

function ReceptionHistory({ order }: { order: SupplierOrderDetail }): ReactElement {
  return (
    <section className="mt-7 border-t border-[#e3e8ee] pt-5">
      <h5 className="font-semibold text-[#17202a]">Entregas anteriores</h5>
      <div className="mt-3 grid gap-3">
        {order.recepciones.map((receipt, index) => (
          <article className="rounded-md border border-[#d7dee6] p-4" key={receipt.recepcionId}>
            <div className="flex flex-wrap justify-between gap-2 text-sm">
              <span className="font-semibold">Entrega {index + 1} · {formatDate(receipt.fechaHora)}</span>
              <span>{receipt.responsableNombre}</span>
            </div>
            <ul className="mt-3 grid gap-1 text-sm text-[#44515d]">
              {receipt.lineas.map((line) => (
                <li key={line.loteId}>
                  {line.nombre}: {line.cantidad} · lote {shortId(line.loteId)} · costo ${line.precioCosto}
                  {line.fechaVencimiento ? ` · vence ${line.fechaVencimiento}` : ""}
                </li>
              ))}
            </ul>
          </article>
        ))}
        {order.recepciones.length === 0 ? (
          <p className="text-sm text-[#61717f]">No hay recepciones registradas.</p>
        ) : null}
      </div>

      <h5 className="mt-6 font-semibold text-[#17202a]">Historial del pedido</h5>
      <ol className="mt-3 grid gap-2 text-sm text-[#44515d]">
        {order.historial.map((event) => (
          <li className="rounded-md bg-[#f6f7f9] px-3 py-2" key={event.id}>
            <span className="font-semibold">{formatEvent(event.tipo)}</span> · {formatDate(event.fechaHora)} · {event.responsableNombre}
            {event.nota ? <p className="mt-1 text-xs text-[#61717f]">{event.nota}</p> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function LineError({ errors, field, index }: { errors: SupplierOrderFieldErrors; field: string; index: number }): ReactElement | null {
  const message = errors[`lineas.${index}.${field}`];
  return message ? <p className="mt-1 text-xs font-semibold text-[#9f2d20]">{message}</p> : null;
}

function Status({ state }: { state: SupplierOrderListItem["estado"] }): ReactElement {
  return <span className="rounded-full bg-[#edf1f5] px-2 py-1 text-xs font-semibold text-[#24313d]">{supplierOrderStateLabels[state]}</span>;
}

function createOperationId(): string {
  return crypto.randomUUID();
}

function shortId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

function formatDate(value: string): string {
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("es-CL");
}

function formatEvent(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}
