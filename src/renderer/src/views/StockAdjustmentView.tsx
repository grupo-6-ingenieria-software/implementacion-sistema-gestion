import { useState, type FormEvent, type ReactElement } from "react";
import type { Role } from "../../../shared/navigation";
import type {
  ActiveProductSearchItem,
} from "../../../shared/products";
import type {
  StockAdjustmentAvailability,
  StockAdjustmentFieldErrors,
  StockAdjustmentLotOption,
  StockAdjustmentResponse,
} from "../../../shared/inventory-detail";

type Props = {
  role: Role;
  usuarioId: string;
  onNavigate: (path: string) => void;
};

type FormState = {
  loteId: string;
  cantidad: string;
  justificacion: string;
};

const emptyForm: FormState = {
  loteId: "",
  cantidad: "",
  justificacion: "",
};

export function StockAdjustmentView({
  role,
  usuarioId,
  onNavigate,
}: Props): ReactElement {
  const [ean13, setEan13] = useState("");
  const [selectedByName, setSelectedByName] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ActiveProductSearchItem[]>(
    [],
  );
  const [availability, setAvailability] =
    useState<StockAdjustmentAvailability | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<StockAdjustmentFieldErrors>(
    {},
  );
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<"success" | "error">("error");
  const [isLoading, setIsLoading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  const resetProductSelection = (): void => {
    setAvailability(null);
    setForm(emptyForm);
    setFieldErrors({});
    setMessage(null);
    setSelectedByName(false);
  };

  const loadAvailability = async (productEan13: string): Promise<void> => {
    setIsLoading(true);
    setMessage(null);
    setFieldErrors({});

    const response = await window.appApi.invoke<StockAdjustmentAvailability>(
      "ajuste:disponibilidad",
      { ean13: productEan13, usuarioId },
    );

    setIsLoading(false);

    if (response.ok) {
      setAvailability(response.data);
      setEan13(productEan13);
      setForm(emptyForm);
    } else {
      setMessage(response.error.message);
      setMessageType("error");
      setAvailability(null);
    }
  };

  const handleEan13Change = (value: string): void => {
    setEan13(value);
    setSelectedByName(false);
    if (value.length === 13) {
      void loadAvailability(value);
    } else {
      resetProductSelection();
    }
  };

  const handleSearch = async (): Promise<void> => {
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    const response = await window.appApi.invoke<ActiveProductSearchItem[]>(
      "producto:buscar-activo",
      { query: searchQuery.trim(), usuarioId },
    );
    setIsSearching(false);

    if (response.ok) {
      setSearchResults(response.data);
    } else {
      setSearchResults([]);
    }
  };

  const handleSelectProduct = (productEan13: string): void => {
    setSearchResults([]);
    setSearchQuery("");
    setSelectedByName(true);
    void loadAvailability(productEan13);
  };

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setFieldErrors({});
    setMessage(null);

    if (!availability) return;

    setIsLoading(true);

    const response = await window.appApi.invoke<StockAdjustmentResponse>(
      "ajuste:registrar",
      {
        ean13,
        loteId: form.loteId,
        cantidad: Number(form.cantidad),
        justificacion: form.justificacion,
        usuarioId,
      },
    );

    setIsLoading(false);

    if (response.ok) {
      setMessage(
        `Ajuste registrado. Nueva cantidad del lote: ${response.data.nuevaCantidadLote}.`,
      );
      setMessageType("success");
      setForm(emptyForm);
      // Recargar disponibilidad
      void loadAvailability(ean13);
    } else {
      setMessage(response.error.message);
      setMessageType("error");
      if (response.error.fieldErrors) {
        setFieldErrors(response.error.fieldErrors as StockAdjustmentFieldErrors);
      }
    }
  };

  return (
    <section className="px-8 py-8">
      {/* Busqueda de producto */}
      <article className="rounded-md border border-[#cbd5df] bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-[#17202a]">
          Seleccionar producto
        </h3>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {/* Por EAN-13 */}
          <div>
            <label className="text-sm font-semibold text-[#24313d]">
              Buscar por EAN-13
            </label>
            <div className="mt-1">
              <input
                className={`w-full rounded-md border px-3 py-2 ${
                  selectedByName
                    ? "border-[#9ba9b5] bg-[#edf1f5] text-[#61717f]"
                    : "border-[#9ba9b5]"
                }`}
                disabled={selectedByName}
                inputMode="numeric"
                maxLength={13}
                placeholder="EAN-13"
                value={ean13}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, "").slice(0, 13);
                  handleEan13Change(value);
                }}
              />
            </div>
          </div>

          {/* Por nombre */}
          <div>
            <label className="text-sm font-semibold text-[#24313d]">
              Buscar por nombre
            </label>
            <div className="mt-1 flex gap-2">
              <input
                className="w-full rounded-md border border-[#9ba9b5] px-3 py-2 text-sm"
                placeholder="Nombre del producto"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSearch();
                }}
              />
              <button
                className="rounded-md bg-[#244d61] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1f4354] disabled:opacity-60"
                disabled={isSearching}
                type="button"
                onClick={() => void handleSearch()}
              >
                Buscar
              </button>
            </div>

            {searchResults.length > 0 ? (
              <div className="mt-2 max-h-40 overflow-y-auto rounded-md border border-[#cbd5df]">
                {searchResults.map((product) => (
                  <button
                    className="w-full border-b border-[#edf0f3] px-3 py-2 text-left text-sm hover:bg-[#f6f7f9]"
                    key={product.ean13}
                    type="button"
                    onClick={() => handleSelectProduct(product.ean13)}
                  >
                    <span className="font-semibold">{product.nombre}</span>
                    <span className="ml-2 text-xs text-[#61717f]">
                      {product.ean13}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </article>

      {/* Mensaje de estado */}
      {message ? (
        <div
          className={`mt-4 rounded-md border px-4 py-3 text-sm font-medium ${
            messageType === "success"
              ? "border-[#a7f3d0] bg-[#d1fae5] text-[#065f46]"
              : "border-[#fecdca] bg-[#fff3f1] text-[#b42318]"
          }`}
        >
          {message}
        </div>
      ) : null}

      {/* Formulario de ajuste */}
      {availability ? (
        <article className="mt-6 rounded-md border border-[#cbd5df] bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-[#17202a]">
            Ajuste de stock — {availability.productoNombre}
          </h3>
          <p className="mt-1 text-sm text-[#61717f]">EAN-13: {ean13}</p>

          <form
            className="mt-4 grid gap-4"
            onSubmit={(e) => void handleSubmit(e)}
          >
            {/* Selector de lote */}
            <div>
              <label className="text-sm font-semibold text-[#24313d]">
                Lote
              </label>
              {availability.lots.length === 0 ? (
                <p className="mt-1 text-sm text-[#61717f]">
                  No hay lotes activos para este producto.
                </p>
              ) : (
                <div className="mt-1 grid gap-2">
                  {availability.lots.map((lot) => (
                    <LotOptionCard
                      key={lot.loteId}
                      lot={lot}
                      selected={form.loteId === lot.loteId}
                      showCost={role === "dueno"}
                      onSelect={() =>
                        setForm((prev) => ({ ...prev, loteId: lot.loteId }))
                      }
                    />
                  ))}
                </div>
              )}
              {fieldErrors.loteId ? (
                <p className="mt-1 text-xs text-[#b42318]">
                  {fieldErrors.loteId}
                </p>
              ) : null}
            </div>

            {/* Cantidad */}
            <label className="grid gap-1 text-sm font-semibold text-[#24313d]">
              Cantidad (positiva para ingreso, negativa para descuento)
              <input
                className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
                inputMode="numeric"
                placeholder="Ej: 5 o -3"
                type="number"
                value={form.cantidad}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, cantidad: e.target.value }))
                }
              />
              {fieldErrors.cantidad ? (
                <p className="text-xs font-normal text-[#b42318]">
                  {fieldErrors.cantidad}
                </p>
              ) : null}
            </label>

            {/* Justificacion */}
            <label className="grid gap-1 text-sm font-semibold text-[#24313d]">
              Justificacion
              <textarea
                className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
                maxLength={200}
                placeholder="Motivo del ajuste"
                rows={3}
                value={form.justificacion}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    justificacion: e.target.value,
                  }))
                }
              />
              <span className="text-xs font-normal text-[#9ba9b5]">
                {form.justificacion.length}/200
              </span>
              {fieldErrors.justificacion ? (
                <p className="text-xs font-normal text-[#b42318]">
                  {fieldErrors.justificacion}
                </p>
              ) : null}
            </label>

            <button
              className="rounded-md bg-[#244d61] px-4 py-3 text-center font-semibold text-white transition hover:bg-[#1f4354] disabled:opacity-60"
              disabled={isLoading || !form.loteId || !form.cantidad}
              type="submit"
            >
              {isLoading ? "Registrando..." : "Registrar ajuste"}
            </button>
          </form>
        </article>
      ) : null}
    </section>
  );
}

function LotOptionCard({
  lot,
  selected,
  showCost,
  onSelect,
}: {
  lot: StockAdjustmentLotOption;
  selected: boolean;
  showCost: boolean;
  onSelect: () => void;
}): ReactElement {
  return (
    <button
      className={`flex items-center justify-between rounded-md border px-4 py-3 text-left text-sm transition ${
        selected
          ? "border-[#2d6a4f] bg-[#ecfdf5]"
          : "border-[#cbd5df] bg-white hover:bg-[#f6f7f9]"
      }`}
      type="button"
      onClick={onSelect}
    >
      <div>
        <span className="font-mono text-xs text-[#61717f]">
          {lot.loteId.slice(0, 8)}...
        </span>
        <span className="ml-3 font-semibold">Cant: {lot.cantidadActual}</span>
        {showCost && lot.precioCosto !== undefined ? (
          <span className="ml-3 text-[#61717f]">
            Costo: ${lot.precioCosto.toLocaleString("es-CL")}
          </span>
        ) : null}
      </div>
      <div className="text-xs text-[#61717f]">
        <span>Ingreso: {lot.fechaIngreso.slice(0, 10)}</span>
        {lot.fechaVencimiento ? (
          <span className="ml-3">Vence: {lot.fechaVencimiento}</span>
        ) : null}
      </div>
    </button>
  );
}
