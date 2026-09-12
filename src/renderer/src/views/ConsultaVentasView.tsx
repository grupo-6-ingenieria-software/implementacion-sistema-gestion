import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from "react";
import {
  formatChileanPeso,
  getChileDateKey,
  isValidSaleHistoryDate,
  isValidSaleId,
  type PaymentMethod,
  type SaleDetail,
  type SaleHistoryListItem,
  type SaleHistorySearchRequest,
  type SaleHistorySearchResult,
  type SaleState,
} from "../../../shared/sales";

const SALES_QUERY_PATH = "/app/ventas/consulta";

type SearchMode = SaleHistorySearchRequest["criterio"];
type FieldErrors = Partial<
  Record<"fechaInicio" | "fechaTermino" | "ventaId", string>
>;

type Props = {
  usuarioId: string;
  currentPath: string;
  onNavigate: (path: string) => void;
};

export type SaleHistoryRouteState = {
  request?: SaleHistorySearchRequest;
  selectedSaleId?: string;
};

const paymentLabels: Record<PaymentMethod, string> = {
  efectivo: "Efectivo",
  debito: "Débito",
  credito: "Crédito",
  transferencia: "Transferencia",
};

export function ConsultaVentasView({
  usuarioId,
  currentPath,
  onNavigate,
}: Props): ReactElement {
  const today = useMemo(() => getChileDateKey(), []);
  const [mode, setMode] = useState<SearchMode>("rango");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [saleId, setSaleId] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [searchError, setSearchError] = useState<string | null>(null);
  const [result, setResult] = useState<SaleHistorySearchResult | null>(null);
  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const startDateRef = useRef<HTMLInputElement>(null);
  const endDateRef = useRef<HTMLInputElement>(null);
  const saleIdRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const searchRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const processedPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (processedPathRef.current === currentPath) return;
    processedPathRef.current = currentPath;
    const route = parseSaleHistoryRoute(currentPath);
    if (!route.request) return;

    applyRequestToFields(route.request);
    void executeSearch(route.request, route.selectedSaleId);
  }, [currentPath]);

  function applyRequestToFields(request: SaleHistorySearchRequest): void {
    setMode(request.criterio);
    if (request.criterio === "rango") {
      setStartDate(request.fechaInicio);
      setEndDate(request.fechaTermino);
    } else {
      setSaleId(request.ventaId);
    }
  }

  function resetDisplayedData(): void {
    searchRequestRef.current += 1;
    detailRequestRef.current += 1;
    setResult(null);
    setDetail(null);
    setSearchError(null);
    setDetailError(null);
    setFieldErrors({});
    setIsSearching(false);
    setIsLoadingDetail(false);
  }

  function changeMode(nextMode: SearchMode): void {
    if (isSearching || isLoadingDetail) return;
    setMode(nextMode);
    resetDisplayedData();
    window.requestAnimationFrame(() => {
      if (nextMode === "rango") startDateRef.current?.focus();
      else saleIdRef.current?.focus();
    });
  }

  function submitSearch(event: FormEvent): void {
    event.preventDefault();
    if (isSearching || isLoadingDetail) return;

    const validation = validateSearch(mode, startDate, endDate, saleId);
    setFieldErrors(validation.errors);
    setSearchError(null);
    setDetailError(null);

    if (!validation.request) {
      window.requestAnimationFrame(() => {
        if (validation.errors.fechaInicio) startDateRef.current?.focus();
        else if (validation.errors.fechaTermino) endDateRef.current?.focus();
        else saleIdRef.current?.focus();
      });
      return;
    }

    const path = buildSaleHistoryPath(validation.request);
    if (path === currentPath) {
      void executeSearch(validation.request);
    } else {
      onNavigate(path);
    }
  }

  async function executeSearch(
    request: SaleHistorySearchRequest,
    selectedSaleId?: string,
  ): Promise<void> {
    const requestId = ++searchRequestRef.current;
    detailRequestRef.current += 1;
    setIsSearching(true);
    setSearchError(null);
    setDetailError(null);
    setFieldErrors({});
    setResult(null);
    setDetail(null);

    try {
      const response = await window.appApi.invoke<SaleHistorySearchResult>(
        "venta:buscar",
        { ...request, usuarioId },
      );
      if (requestId !== searchRequestRef.current) return;

      if (!response.ok) {
        setSearchError(response.error.message);
        window.requestAnimationFrame(() => errorRef.current?.focus());
        return;
      }

      setResult(response.data);
      window.requestAnimationFrame(() => resultsHeadingRef.current?.focus());

      if (
        selectedSaleId &&
        response.data.ventas.some((sale) => sale.ventaId === selectedSaleId)
      ) {
        await loadDetail(selectedSaleId, request, false);
      }
    } catch {
      if (requestId === searchRequestRef.current) {
        setSearchError(
          "No fue posible comunicarse con el proceso principal. Intente nuevamente.",
        );
        window.requestAnimationFrame(() => errorRef.current?.focus());
      }
    } finally {
      if (requestId === searchRequestRef.current) setIsSearching(false);
    }
  }

  async function loadDetail(
    id: string,
    request: SaleHistorySearchRequest,
    updatePath = true,
  ): Promise<void> {
    if (isLoadingDetail) return;
    const requestId = ++detailRequestRef.current;
    setIsLoadingDetail(true);
    setDetailError(null);

    try {
      const response = await window.appApi.invoke<SaleDetail>(
        "venta:detalle",
        { ventaId: id, usuarioId },
      );
      if (requestId !== detailRequestRef.current) return;

      if (!response.ok) {
        setDetailError(response.error.message);
        return;
      }

      setDetail(response.data);
      if (updatePath) {
        const path = buildSaleHistoryPath(request, id);
        processedPathRef.current = path;
        onNavigate(path);
      }
      window.requestAnimationFrame(() => detailHeadingRef.current?.focus());
    } catch {
      if (requestId === detailRequestRef.current) {
        setDetailError(
          "No fue posible cargar el detalle de la venta. Intente nuevamente.",
        );
      }
    } finally {
      if (requestId === detailRequestRef.current) setIsLoadingDetail(false);
    }
  }

  function clearFilters(): void {
    resetDisplayedData();
    setMode("rango");
    setStartDate(today);
    setEndDate(today);
    setSaleId("");
    processedPathRef.current = SALES_QUERY_PATH;
    if (currentPath !== SALES_QUERY_PATH) onNavigate(SALES_QUERY_PATH);
    window.requestAnimationFrame(() => startDateRef.current?.focus());
  }

  const appliedRequest = parseSaleHistoryRoute(currentPath).request;

  return (
    <section className="space-y-6 px-8 py-8">
      <header>
        <h3 className="text-2xl font-semibold text-[#17202a]">
          Consulta de ventas
        </h3>
        <p className="mt-1 text-sm text-[#61717f]">
          Busca ventas históricas por rango de fechas o número de venta.
        </p>
      </header>

      <form
        className="rounded-md border border-[#cbd5df] bg-white p-6 shadow-sm"
        onSubmit={submitSearch}
        noValidate
      >
        <fieldset disabled={isSearching || isLoadingDetail}>
          <legend className="text-sm font-semibold text-[#24313d]">
            Buscar por
          </legend>
          <div className="mt-3 flex flex-wrap gap-5">
            <label className="flex items-center gap-2 text-sm text-[#24313d]">
              <input
                checked={mode === "rango"}
                name="sales-query-mode"
                type="radio"
                onChange={() => changeMode("rango")}
              />
              Rango de fechas
            </label>
            <label className="flex items-center gap-2 text-sm text-[#24313d]">
              <input
                checked={mode === "numero"}
                name="sales-query-mode"
                type="radio"
                onChange={() => changeMode("numero")}
              />
              Número de venta
            </label>
          </div>

          {mode === "rango" ? (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <DateField
                id="sales-query-start"
                label="Fecha de inicio"
                value={startDate}
                error={fieldErrors.fechaInicio}
                inputRef={startDateRef}
                onChange={(value) => {
                  setStartDate(value);
                  setFieldErrors((current) => ({
                    ...current,
                    fechaInicio: undefined,
                  }));
                }}
              />
              <DateField
                id="sales-query-end"
                label="Fecha de término"
                value={endDate}
                error={fieldErrors.fechaTermino}
                inputRef={endDateRef}
                onChange={(value) => {
                  setEndDate(value);
                  setFieldErrors((current) => ({
                    ...current,
                    fechaTermino: undefined,
                  }));
                }}
              />
            </div>
          ) : (
            <div className="mt-5">
              <label
                className="text-sm font-semibold text-[#24313d]"
                htmlFor="sales-query-id"
              >
                Número de venta
              </label>
              <input
                ref={saleIdRef}
                id="sales-query-id"
                className="mt-2 w-full rounded-md border border-[#9ba9b5] px-3 py-2 font-mono text-sm"
                value={saleId}
                aria-invalid={Boolean(fieldErrors.ventaId)}
                aria-describedby="sales-query-id-error"
                placeholder="00000000-0000-4000-8000-000000000000"
                onChange={(event) => {
                  setSaleId(event.target.value);
                  setFieldErrors((current) => ({
                    ...current,
                    ventaId: undefined,
                  }));
                }}
              />
              <FieldError id="sales-query-id-error" message={fieldErrors.ventaId} />
            </div>
          )}

          <div className="mt-5 flex flex-wrap justify-end gap-3 border-t border-[#e3e8ee] pt-4">
            <button
              className="rounded-md border border-[#9ba9b5] px-4 py-2 text-sm font-semibold text-[#24313d] hover:bg-[#f0f3f6]"
              type="button"
              onClick={clearFilters}
            >
              Limpiar
            </button>
            <button
              className="rounded-md bg-[#244d61] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1f4354] disabled:bg-[#9ba9b5]"
              type="submit"
            >
              {isSearching ? "Buscando..." : "Buscar"}
            </button>
          </div>
        </fieldset>
      </form>

      {searchError ? (
        <p
          ref={errorRef}
          className="rounded-md border border-[#dba7a7] bg-[#fff7f7] p-4 text-sm font-semibold text-[#8f2727] outline-none"
          role="alert"
          tabIndex={-1}
        >
          {searchError}
        </p>
      ) : null}

      {isSearching ? <ViewMessage message="Buscando ventas..." /> : null}

      {!isSearching && !result && !searchError ? (
        <ViewMessage message="Selecciona un criterio y presiona Buscar para consultar ventas." />
      ) : null}

      {!isSearching && result ? (
        <>
          <SalesSearchSummary summary={result.resumen} />
          <section className="overflow-hidden rounded-md border border-[#cbd5df] bg-white shadow-sm">
            <h4
              ref={resultsHeadingRef}
              className="border-b border-[#e3e8ee] px-5 py-4 text-lg font-semibold text-[#17202a] outline-none"
              tabIndex={-1}
            >
              Resultados
            </h4>
            {result.ventas.length === 0 ? (
              <ViewMessage message="No se encontraron ventas para los filtros indicados." />
            ) : (
              <SalesTable
                sales={result.ventas}
                selectedSaleId={detail?.ventaId}
                isLoadingDetail={isLoadingDetail}
                onDetail={(id) => {
                  if (appliedRequest) void loadDetail(id, appliedRequest);
                }}
                onAnnul={(id) => {
                  if (!appliedRequest) return;
                  const returnPath = buildSaleHistoryPath(appliedRequest, id);
                  onNavigate(buildSaleAnnulmentPath(id, returnPath));
                }}
              />
            )}
          </section>
        </>
      ) : null}

      {detailError ? (
        <p
          className="rounded-md border border-[#dba7a7] bg-[#fff7f7] p-4 text-sm font-semibold text-[#8f2727]"
          role="alert"
        >
          {detailError}
        </p>
      ) : null}
      {isLoadingDetail ? <ViewMessage message="Cargando detalle de la venta..." /> : null}
      {detail && !isLoadingDetail ? (
        <SaleDetailPanel
          detail={detail}
          headingRef={detailHeadingRef}
          onClose={() => {
            setDetail(null);
            setDetailError(null);
            if (appliedRequest) {
              const path = buildSaleHistoryPath(appliedRequest);
              processedPathRef.current = path;
              onNavigate(path);
            }
          }}
        />
      ) : null}
    </section>
  );
}

function DateField({
  id,
  label,
  value,
  error,
  inputRef,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
}): ReactElement {
  return (
    <div className="grid gap-2">
      <label className="text-sm font-semibold text-[#24313d]" htmlFor={id}>
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
        type="date"
        value={value}
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-error`}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

function FieldError({ id, message }: { id: string; message?: string }): ReactElement {
  return (
    <span id={id} className="text-sm font-semibold text-[#b42318]" role={message ? "alert" : undefined}>
      {message}
    </span>
  );
}

function SalesSearchSummary({
  summary,
}: {
  summary: SaleHistorySearchResult["resumen"];
}): ReactElement {
  return (
    <section className="grid gap-4 sm:grid-cols-3" aria-label="Resumen de la consulta">
      <SummaryCard label="Ventas vigentes" value={String(summary.ventasVigentes)} />
      <SummaryCard label="Monto vigente" value={formatChileanPeso(summary.montoVigente)} />
      <SummaryCard label="Ventas anuladas" value={String(summary.ventasAnuladas)} />
    </section>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <dl className="rounded-md border border-[#cbd5df] bg-white p-5 shadow-sm">
      <dt className="text-sm font-semibold text-[#61717f]">{label}</dt>
      <dd className="mt-2 text-2xl font-semibold text-[#17202a]">{value}</dd>
    </dl>
  );
}

function SalesTable({
  sales,
  selectedSaleId,
  isLoadingDetail,
  onDetail,
  onAnnul,
}: {
  sales: SaleHistoryListItem[];
  selectedSaleId?: string;
  isLoadingDetail: boolean;
  onDetail: (id: string) => void;
  onAnnul: (id: string) => void;
}): ReactElement {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-[#f0f3f6] text-[#61717f]">
          <tr>
            <th className="px-4 py-3 font-semibold">Número de venta</th>
            <th className="px-4 py-3 font-semibold">Fecha y hora</th>
            <th className="px-4 py-3 font-semibold">Responsable</th>
            <th className="px-4 py-3 text-right font-semibold">Total</th>
            <th className="px-4 py-3 font-semibold">Método de pago</th>
            <th className="px-4 py-3 font-semibold">Estado</th>
            <th className="px-4 py-3 text-right font-semibold">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {sales.map((sale) => (
            <tr className="border-t border-[#e1e7ee]" key={sale.ventaId}>
              <td className="px-4 py-4 font-mono text-xs text-[#24313d]">{sale.ventaId}</td>
              <td className="px-4 py-4 text-[#24313d]">{formatDateTime(sale.fechaHora)}</td>
              <td className="px-4 py-4 text-[#24313d]">{sale.responsable.nombre}</td>
              <td className="px-4 py-4 text-right font-semibold text-[#17202a]">
                {formatChileanPeso(sale.total)}
              </td>
              <td className="px-4 py-4 text-[#24313d]">{paymentLabels[sale.metodoPago]}</td>
              <td className="px-4 py-4"><StatusBadge state={sale.estado} /></td>
              <td className="px-4 py-4">
                <div className="flex justify-end gap-2">
                  <button
                    className="rounded-md border border-[#607482] px-3 py-2 text-xs font-semibold text-[#244d61] hover:bg-[#f0f3f6] disabled:text-[#9ba9b5]"
                    disabled={isLoadingDetail}
                    type="button"
                    aria-pressed={selectedSaleId === sale.ventaId}
                    onClick={() => onDetail(sale.ventaId)}
                  >
                    Ver detalle
                  </button>
                  {sale.puedeAnular ? (
                    <button
                      className="rounded-md border border-[#9f2d20] px-3 py-2 text-xs font-semibold text-[#9f2d20] hover:bg-[#fff3f1]"
                      type="button"
                      onClick={() => onAnnul(sale.ventaId)}
                    >
                      Anular
                    </button>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SaleDetailPanel({
  detail,
  headingRef,
  onClose,
}: {
  detail: SaleDetail;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
}): ReactElement {
  const discountAmount = detail.subtotal - detail.total;
  const discountLabel =
    detail.descuento.tipo === "porcentaje"
      ? `${detail.descuento.valor}% (${formatChileanPeso(discountAmount)})`
      : formatChileanPeso(discountAmount);

  return (
    <article className="rounded-md border border-[#cbd5df] bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h4 ref={headingRef} className="text-xl font-semibold text-[#17202a] outline-none" tabIndex={-1}>
            Detalle de la venta
          </h4>
          <p className="mt-1 font-mono text-xs text-[#61717f]">{detail.ventaId}</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge state={detail.estado} />
          <button
            className="rounded-md border border-[#9ba9b5] px-3 py-2 text-xs font-semibold text-[#24313d] hover:bg-[#f0f3f6]"
            type="button"
            onClick={onClose}
          >
            Cerrar detalle
          </button>
        </div>
      </div>

      <dl className="mt-5 grid gap-4 rounded-md bg-[#f6f8fa] p-4 sm:grid-cols-2">
        <Info label="Responsable" value={detail.responsable.nombre} />
        <Info label="Fecha y hora" value={formatDateTime(detail.fechaHora)} />
      </dl>

      <div className="mt-5 overflow-x-auto rounded-md border border-[#d7dee6]">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-[#eef2f5] text-[#526574]">
            <tr>
              <th className="px-4 py-3 font-semibold">Producto</th>
              <th className="px-4 py-3 font-semibold">EAN-13</th>
              <th className="px-4 py-3 text-right font-semibold">Cantidad</th>
              <th className="px-4 py-3 text-right font-semibold">Precio histórico</th>
              <th className="px-4 py-3 text-right font-semibold">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {detail.productos.map((product) => (
              <tr className="border-t border-[#d7dee6]" key={product.productoId}>
                <td className="px-4 py-3 font-medium">{product.nombre}</td>
                <td className="px-4 py-3 font-mono text-xs text-[#61717f]">{product.ean13}</td>
                <td className="px-4 py-3 text-right">{product.cantidad}</td>
                <td className="px-4 py-3 text-right">{formatChileanPeso(product.precioUnitario)}</td>
                <td className="px-4 py-3 text-right font-semibold">{formatChileanPeso(product.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <dl className="space-y-3 rounded-md border border-[#d7dee6] p-4 text-sm">
          <MoneyLine label="Subtotal" value={detail.subtotal} />
          <div className="flex items-center justify-between gap-4">
            <dt className="text-[#61717f]">Descuento</dt>
            <dd className="font-semibold">{discountLabel}</dd>
          </div>
          {detail.descuento.razon ? (
            <Info label="Razón del descuento" value={detail.descuento.razon} />
          ) : null}
          <MoneyLine label="Total" value={detail.total} strong />
        </dl>
        <dl className="space-y-3 rounded-md border border-[#d7dee6] p-4 text-sm">
          <Info label="Método de pago" value={paymentLabels[detail.pago.metodo]} />
          {detail.pago.montoRecibido !== undefined ? (
            <MoneyLine label="Monto recibido" value={detail.pago.montoRecibido} />
          ) : null}
          {detail.pago.vuelto !== undefined ? (
            <MoneyLine label="Vuelto" value={detail.pago.vuelto} />
          ) : null}
        </dl>
      </div>
    </article>
  );
}

function ViewMessage({ message }: { message: string }): ReactElement {
  return (
    <div className="rounded-md border border-[#cbd5df] bg-white px-6 py-10 text-center text-sm font-medium text-[#61717f] shadow-sm" role="status">
      {message}
    </div>
  );
}

function StatusBadge({ state }: { state: SaleState }): ReactElement {
  const annulled = state === "anulada";
  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${annulled ? "bg-[#fff0f0] text-[#9a3333]" : "bg-[#e8f3ed] text-[#2d6a4f]"}`}>
      {annulled ? "Anulada" : "Vigente"}
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

function MoneyLine({ label, value, strong = false }: { label: string; value: number; strong?: boolean }): ReactElement {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-[#61717f]">{label}</dt>
      <dd className={strong ? "text-lg font-semibold" : "font-semibold"}>{formatChileanPeso(value)}</dd>
    </div>
  );
}

export function validateSearch(
  mode: SearchMode,
  startDate: string,
  endDate: string,
  saleId: string,
): { request?: SaleHistorySearchRequest; errors: FieldErrors } {
  const errors: FieldErrors = {};
  if (mode === "numero") {
    if (!isValidSaleId(saleId)) {
      errors.ventaId = "Ingrese un número de venta válido en formato UUID.";
      return { errors };
    }
    return {
      request: { criterio: "numero", ventaId: saleId.trim() },
      errors,
    };
  }

  if (!isValidSaleHistoryDate(startDate)) {
    errors.fechaInicio = "Ingrese una fecha de inicio válida.";
  }
  if (!isValidSaleHistoryDate(endDate)) {
    errors.fechaTermino = "Ingrese una fecha de término válida.";
  }
  if (!errors.fechaInicio && !errors.fechaTermino && startDate > endDate) {
    errors.fechaTermino =
      "La fecha de inicio no puede ser posterior a la fecha de término.";
  }
  if (Object.keys(errors).length > 0) return { errors };

  return {
    request: {
      criterio: "rango",
      fechaInicio: startDate,
      fechaTermino: endDate,
    },
    errors,
  };
}

export function buildSaleHistoryPath(
  request: SaleHistorySearchRequest,
  selectedSaleId?: string,
): string {
  const params = new URLSearchParams({ criterio: request.criterio });
  if (request.criterio === "rango") {
    params.set("fechaInicio", request.fechaInicio);
    params.set("fechaTermino", request.fechaTermino);
  } else {
    params.set("numero", request.ventaId);
  }
  if (selectedSaleId && isValidSaleId(selectedSaleId)) {
    params.set("seleccion", selectedSaleId.trim());
  }
  return `${SALES_QUERY_PATH}?${params.toString()}`;
}

export function parseSaleHistoryRoute(path: string): SaleHistoryRouteState {
  const [pathname, query = ""] = path.split("?");
  if (pathname !== SALES_QUERY_PATH || !query) return {};
  const params = new URLSearchParams(query);
  const criterion = params.get("criterio");
  const selected = params.get("seleccion") ?? undefined;
  const selectedSaleId = isValidSaleId(selected) ? selected.trim() : undefined;

  if (criterion === "numero") {
    const validation = validateSearch("numero", "", "", params.get("numero") ?? "");
    return validation.request
      ? { request: validation.request, selectedSaleId }
      : {};
  }
  if (criterion === "rango") {
    const validation = validateSearch(
      "rango",
      params.get("fechaInicio") ?? "",
      params.get("fechaTermino") ?? "",
      "",
    );
    return validation.request
      ? { request: validation.request, selectedSaleId }
      : {};
  }
  return {};
}

export function buildSaleAnnulmentPath(ventaId: string, returnTo: string): string {
  const params = new URLSearchParams({ ventaId, returnTo });
  return `/app/ventas/anular?${params.toString()}`;
}

export function getSafeSalesQueryReturnPath(path: string): string | undefined {
  const [, query = ""] = path.split("?");
  const returnTo = new URLSearchParams(query).get("returnTo");
  if (!returnTo) return undefined;
  const [pathname] = returnTo.split("?");
  if (pathname !== SALES_QUERY_PATH) return undefined;
  return parseSaleHistoryRoute(returnTo).request ? returnTo : undefined;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    dateStyle: "medium",
    timeStyle: "short",
    hourCycle: "h23",
  }).format(new Date(value));
}
