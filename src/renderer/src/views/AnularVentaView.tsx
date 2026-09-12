import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
  type ReactElement,
} from "react";
import {
  formatChileanPeso,
  isValidSaleId,
  type PaymentMethod,
  type SaleAnnulmentResult,
  type SaleDetail,
  type SaleSearchResult,
} from "../../../shared/sales";

type Props = {
  usuarioId: string;
  initialVentaId?: string;
  returnPath?: string;
  onNavigate: (path: string) => void;
};

const paymentLabels: Record<PaymentMethod, string> = {
  efectivo: "Efectivo",
  debito: "Débito",
  credito: "Crédito",
  transferencia: "Transferencia",
};

export function AnularVentaView({
  usuarioId,
  initialVentaId = "",
  returnPath,
  onNavigate,
}: Props): ReactElement {
  const [ventaId, setVentaId] = useState(initialVentaId);
  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [reason, setReason] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [result, setResult] = useState<SaleAnnulmentResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);
  const didLoadInitialRef = useRef(false);

  useEffect(() => {
    if (!initialVentaId || didLoadInitialRef.current) return;
    didLoadInitialRef.current = true;
    void searchSale(initialVentaId);
  }, [initialVentaId]);

  useEffect(() => {
    if (showConfirmation) confirmationRef.current?.focus();
  }, [showConfirmation]);

  async function searchSale(requestedId = ventaId): Promise<void> {
    const normalizedId = requestedId.trim();
    setSearchError(null);
    setReasonError(null);
    setOperationError(null);
    setResult(null);
    setShowConfirmation(false);
    setDetail(null);
    setReason("");

    if (!isValidSaleId(normalizedId)) {
      setSearchError("Ingrese un número de venta válido en formato UUID.");
      searchInputRef.current?.focus();
      return;
    }

    const requestId = ++requestRef.current;
    setIsSearching(true);
    try {
      const search = await window.appApi.invoke<SaleSearchResult>(
        "venta:buscar",
        { ventaId: normalizedId, usuarioId },
      );
      if (requestId !== requestRef.current) return;
      if (!search.ok) {
        setSearchError(search.error.message);
        searchInputRef.current?.focus();
        return;
      }

      const detailResponse = await window.appApi.invoke<SaleDetail>(
        "venta:detalle",
        { ventaId: search.data.ventaId, usuarioId },
      );
      if (requestId !== requestRef.current) return;
      if (!detailResponse.ok) {
        setSearchError(detailResponse.error.message);
        searchInputRef.current?.focus();
        return;
      }

      setVentaId(detailResponse.data.ventaId);
      setDetail(detailResponse.data);
      window.requestAnimationFrame(() => detailHeadingRef.current?.focus());
    } catch {
      if (requestId === requestRef.current) {
        setSearchError(
          "No fue posible comunicarse con el proceso principal. Intente nuevamente.",
        );
        searchInputRef.current?.focus();
      }
    } finally {
      if (requestId === requestRef.current) setIsSearching(false);
    }
  }

  function requestAnnulment(): void {
    setReasonError(null);
    setOperationError(null);
    if (!reason.trim()) {
      setReasonError("La razón de anulación es obligatoria.");
      reasonRef.current?.focus();
      return;
    }
    setShowConfirmation(true);
  }

  async function confirmAnnulment(): Promise<void> {
    if (!detail || isSaving) return;
    const normalizedReason = reason.trim();
    if (!normalizedReason) {
      setShowConfirmation(false);
      setReasonError("La razón de anulación es obligatoria.");
      reasonRef.current?.focus();
      return;
    }

    setOperationError(null);
    setReasonError(null);
    setIsSaving(true);
    try {
      const response = await window.appApi.invoke<SaleAnnulmentResult>(
        "venta:anular",
        {
          ventaId: detail.ventaId,
          razon: normalizedReason,
          usuarioId,
        },
      );

      if (!response.ok) {
        setOperationError(response.error.message);
        setShowConfirmation(false);
        if (response.error.code === "VALIDATION_ERROR") {
          setReasonError(response.error.message);
          reasonRef.current?.focus();
        }
        await refreshDetail(detail.ventaId);
        return;
      }

      setResult(response.data);
      setShowConfirmation(false);
      setReason("");
      setDetail((current) =>
        current ? { ...current, estado: "anulada" } : current,
      );
      await refreshDetail(response.data.ventaId);
    } catch {
      setOperationError(
        "No fue posible completar la anulación. Revise la conexión e intente nuevamente.",
      );
      setShowConfirmation(false);
    } finally {
      setIsSaving(false);
    }
  }

  async function refreshDetail(id: string): Promise<void> {
    try {
      const response = await window.appApi.invoke<SaleDetail>(
        "venta:detalle",
        { ventaId: id, usuarioId },
      );
      if (response.ok) setDetail(response.data);
    } catch {
      // El detalle ya visible se conserva ante un fallo de actualización.
    }
  }

  const canRequestAnnulment =
    detail?.estado === "confirmada" &&
    detail.caja.estado === "abierta" &&
    !isSaving;

  return (
    <section className="space-y-6 px-8 py-8">
      <header>
        <h3 className="text-2xl font-semibold text-[#17202a]">
          Anular venta
        </h3>
        <p className="mt-1 text-sm text-[#61717f]">
          Solo se pueden anular ventas vigentes del día cuya caja asociada
          permanezca abierta.
        </p>
      </header>

      <form
        className="rounded-md border border-[#cbd5df] bg-white p-6 shadow-sm"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void searchSale();
        }}
        noValidate
      >
        <label
          className="text-sm font-semibold text-[#24313d]"
          htmlFor="sale-annulment-id"
        >
          Número de venta
        </label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <input
            ref={searchInputRef}
            id="sale-annulment-id"
            className="min-w-0 flex-1 rounded-md border border-[#9ba9b5] px-3 py-2 font-mono text-sm"
            value={ventaId}
            disabled={isSearching || isSaving}
            aria-invalid={Boolean(searchError)}
            aria-describedby="sale-annulment-id-help sale-annulment-id-error"
            autoFocus={!initialVentaId}
            placeholder="00000000-0000-4000-8000-000000000000"
            onChange={(event) => {
              requestRef.current += 1;
              setVentaId(event.target.value);
              setSearchError(null);
              setDetail(null);
              setReason("");
              setResult(null);
              setOperationError(null);
              setShowConfirmation(false);
            }}
          />
          <button
            className="rounded-md bg-[#244d61] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#1f4354] disabled:cursor-not-allowed disabled:bg-[#9ba9b5]"
            disabled={isSearching || isSaving}
            type="submit"
          >
            {isSearching ? "Buscando..." : "Buscar venta"}
          </button>
        </div>
        <p id="sale-annulment-id-help" className="mt-2 text-xs text-[#61717f]">
          Ingrese el UUID completo mostrado en el comprobante o en Ventas del
          día.
        </p>
        <p
          id="sale-annulment-id-error"
          className="mt-2 text-sm font-semibold text-[#b42318]"
          role={searchError ? "alert" : undefined}
        >
          {searchError}
        </p>
      </form>

      {detail ? (
        <SaleDetailPanel
          detail={detail}
          headingRef={detailHeadingRef}
          reason={reason}
          reasonError={reasonError}
          operationError={operationError}
          result={result}
          isSaving={isSaving}
          showConfirmation={showConfirmation}
          confirmationRef={confirmationRef}
          canRequestAnnulment={canRequestAnnulment}
          reasonRef={reasonRef}
          onReasonChange={(value) => {
            setReason(value);
            setReasonError(null);
            setOperationError(null);
            setShowConfirmation(false);
          }}
          onRequest={requestAnnulment}
          onCancelConfirmation={() => setShowConfirmation(false)}
          onConfirm={() => void confirmAnnulment()}
        />
      ) : null}

      <button
        className="rounded-md border border-[#9ba9b5] px-4 py-2 text-sm font-semibold text-[#24313d] transition hover:bg-[#f0f3f6]"
        type="button"
        onClick={() => onNavigate(returnPath ?? "/app/ventas/dia")}
      >
        {returnPath ? "Volver a Consulta de ventas" : "Volver a Ventas del día"}
      </button>
    </section>
  );
}

function SaleDetailPanel({
  detail,
  headingRef,
  reason,
  reasonError,
  operationError,
  result,
  isSaving,
  showConfirmation,
  confirmationRef,
  canRequestAnnulment,
  reasonRef,
  onReasonChange,
  onRequest,
  onCancelConfirmation,
  onConfirm,
}: {
  detail: SaleDetail;
  headingRef: RefObject<HTMLHeadingElement | null>;
  reason: string;
  reasonError: string | null;
  operationError: string | null;
  result: SaleAnnulmentResult | null;
  isSaving: boolean;
  showConfirmation: boolean;
  confirmationRef: RefObject<HTMLDivElement | null>;
  canRequestAnnulment: boolean;
  reasonRef: RefObject<HTMLTextAreaElement | null>;
  onReasonChange: (value: string) => void;
  onRequest: () => void;
  onCancelConfirmation: () => void;
  onConfirm: () => void;
}): ReactElement {
  return (
    <article className="space-y-6 rounded-md border border-[#cbd5df] bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h4
            ref={headingRef}
            className="text-xl font-semibold text-[#17202a] outline-none"
            tabIndex={-1}
          >
            Detalle de la venta
          </h4>
          <p className="mt-1 break-all font-mono text-xs text-[#61717f]">
            {detail.ventaId}
          </p>
        </div>
        <StatusBadge state={detail.estado} />
      </div>

      <dl className="grid gap-4 rounded-md bg-[#f8fafb] p-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <Info label="Responsable" value={detail.responsable.nombre} />
        <Info label="Fecha y hora" value={formatDateTime(detail.fechaHora)} />
        <Info label="Método de pago" value={paymentLabels[detail.pago.metodo]} />
        <Info
          label="Caja asociada"
          value={detail.caja.estado === "abierta" ? "Abierta" : "Cerrada"}
        />
      </dl>

      <div className="overflow-x-auto rounded-md border border-[#d7dee6]">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-[#f0f3f6] text-[#61717f]">
            <tr>
              <th className="px-4 py-3 font-semibold">Producto</th>
              <th className="px-4 py-3 font-semibold">EAN-13</th>
              <th className="px-4 py-3 text-right font-semibold">Cantidad</th>
              <th className="px-4 py-3 text-right font-semibold">Precio</th>
              <th className="px-4 py-3 text-right font-semibold">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {detail.productos.map((product) => (
              <tr className="border-t border-[#e1e7ee]" key={product.productoId}>
                <td className="px-4 py-3 font-semibold text-[#24313d]">
                  {product.nombre}
                </td>
                <td className="px-4 py-3 text-[#61717f]">{product.ean13}</td>
                <td className="px-4 py-3 text-right">{product.cantidad}</td>
                <td className="px-4 py-3 text-right">
                  {formatChileanPeso(product.precioUnitario)}
                </td>
                <td className="px-4 py-3 text-right font-semibold">
                  {formatChileanPeso(product.subtotal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <dl className="grid content-start gap-3 rounded-md border border-[#d7dee6] p-4 text-sm">
          <MoneyLine label="Subtotal" value={detail.subtotal} />
          <MoneyLine
            label={
              detail.descuento.tipo === "porcentaje"
                ? `Descuento (${detail.descuento.valor}%)`
                : "Descuento"
            }
            value={Math.max(0, detail.subtotal - detail.total)}
          />
          {detail.descuento.razon ? (
            <Info label="Razón del descuento" value={detail.descuento.razon} />
          ) : null}
          <MoneyLine label="Total" value={detail.total} strong />
          {detail.pago.montoRecibido !== undefined ? (
            <MoneyLine label="Monto recibido" value={detail.pago.montoRecibido} />
          ) : null}
          {detail.pago.vuelto !== undefined ? (
            <MoneyLine label="Vuelto" value={detail.pago.vuelto} />
          ) : null}
        </dl>

        <div className="space-y-3">
          {detail.caja.estado === "cerrada" ? (
            <p className="rounded-md border border-[#dba7a7] bg-[#fff7f7] p-4 text-sm font-semibold text-[#8f2727]" role="alert">
              La caja asociada está cerrada. Esta venta no puede anularse.
            </p>
          ) : null}
          {detail.estado === "anulada" && !result ? (
            <p className="rounded-md border border-[#dba7a7] bg-[#fff7f7] p-4 text-sm font-semibold text-[#8f2727]" role="status">
              Esta venta ya se encuentra anulada y conserva su detalle histórico.
            </p>
          ) : null}
          {result ? (
            <p className="rounded-md border border-[#9bc8ae] bg-[#eef8f1] p-4 text-sm font-semibold text-[#246044]" role="status">
              Venta anulada correctamente. Se restituyeron {result.unidadesRestituidas}{" "}
              unidades en {result.lotesRestituidos}{" "}
              {result.lotesRestituidos === 1 ? "lote" : "lotes"}.
            </p>
          ) : null}
          {operationError ? (
            <p className="rounded-md border border-[#dba7a7] bg-[#fff7f7] p-4 text-sm font-semibold text-[#8f2727]" role="alert">
              {operationError}
            </p>
          ) : null}

          <label
            className="block text-sm font-semibold text-[#24313d]"
            htmlFor="sale-annulment-reason"
          >
            Razón de anulación
          </label>
          <textarea
            ref={reasonRef}
            id="sale-annulment-reason"
            className="min-h-28 w-full rounded-md border border-[#9ba9b5] px-3 py-2 text-sm disabled:bg-[#edf1f5]"
            value={reason}
            disabled={!canRequestAnnulment}
            aria-invalid={Boolean(reasonError)}
            aria-describedby="sale-annulment-reason-error"
            onChange={(event) => onReasonChange(event.target.value)}
          />
          <p
            id="sale-annulment-reason-error"
            className="text-sm font-semibold text-[#b42318]"
            role={reasonError ? "alert" : undefined}
          >
            {reasonError}
          </p>
          <button
            className="rounded-md bg-[#9f2d20] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#84251b] disabled:cursor-not-allowed disabled:bg-[#9ba9b5]"
            disabled={!canRequestAnnulment}
            type="button"
            onClick={onRequest}
          >
            Anular venta
          </button>
        </div>
      </div>

      {showConfirmation ? (
        <div
          ref={confirmationRef}
          className="rounded-md border border-[#e3ad72] bg-[#fff8ed] p-4 outline-none"
          role="alert"
          aria-labelledby="sale-annulment-confirm-title"
          tabIndex={-1}
        >
          <p
            id="sale-annulment-confirm-title"
            className="font-semibold text-[#7a3f0c]"
          >
            Confirma que deseas anular esta venta.
          </p>
          <p className="mt-1 text-sm text-[#6b4a24]">
            Se restituirá el stock de los lotes exactos y la operación no podrá
            repetirse.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              className="rounded-md border border-[#9ba9b5] bg-white px-4 py-2 text-sm font-semibold text-[#24313d]"
              disabled={isSaving}
              type="button"
              onClick={onCancelConfirmation}
            >
              Cancelar
            </button>
            <button
              className="rounded-md bg-[#8a3b2d] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#c9a59d]"
              disabled={isSaving}
              type="button"
              onClick={onConfirm}
            >
              {isSaving ? "Anulando..." : "Confirmar anulación"}
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function StatusBadge({ state }: { state: SaleDetail["estado"] }): ReactElement {
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
        state === "anulada"
          ? "bg-[#fff0f0] text-[#9a3333]"
          : "bg-[#e8f3ed] text-[#2d6a4f]"
      }`}
    >
      {state === "anulada" ? "Anulada" : "Vigente"}
    </span>
  );
}

function Info({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-[#61717f]">{label}</dt>
      <dd className="mt-1 font-semibold text-[#24313d]">{value}</dd>
    </div>
  );
}

function MoneyLine({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: number;
  strong?: boolean;
}): ReactElement {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-[#61717f]">{label}</dt>
      <dd className={strong ? "text-lg font-semibold" : "font-semibold"}>
        {formatChileanPeso(value)}
      </dd>
    </div>
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    dateStyle: "medium",
    timeStyle: "short",
    hourCycle: "h23",
  }).format(new Date(value));
}
