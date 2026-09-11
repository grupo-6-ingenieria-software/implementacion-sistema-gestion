import { useEffect, useMemo, useState, type ReactElement } from "react";
import { isValidEan13 } from "../../../shared/ean13";
import type { LotProviderOption } from "../../../shared/lots";
import type { ActiveProductSearchItem } from "../../../shared/products";
import {
  normalizeSupplierOrderCreatePayload,
  validateSupplierOrderCreatePayload,
  type SupplierOrderCreateResponse,
  type SupplierOrderFieldErrors,
} from "../../../shared/supplier-orders";
import { CampoEAN13Input } from "../components";

type SupplierOrderCreateViewProps = {
  usuarioId: string;
  onNavigate: (path: string) => void;
};

type DraftLine = ActiveProductSearchItem & { cantidad: string };

export function SupplierOrderCreateView({
  usuarioId,
  onNavigate,
}: SupplierOrderCreateViewProps): ReactElement {
  const [providers, setProviders] = useState<LotProviderOption[]>([]);
  const [providerId, setProviderId] = useState("");
  const [ean13, setEan13] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [errors, setErrors] = useState<SupplierOrderFieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let current = true;
    void window.appApi
      .invoke<LotProviderOption[]>("lote:proveedores", { usuarioId })
      .then((response) => {
        if (!current) return;
        if (!response.ok) {
          setMessage(response.error.message);
          return;
        }
        setProviders(response.data);
        if (response.data.length === 1) {
          setProviderId(String(response.data[0].id));
        }
      })
      .catch(() => {
        if (current) setMessage("No fue posible cargar los proveedores.");
      })
      .finally(() => {
        if (current) setLoadingProviders(false);
      });

    return () => {
      current = false;
    };
  }, [usuarioId]);

  const normalizedPayload = useMemo(
    () =>
      normalizeSupplierOrderCreatePayload({
        proveedorId: providerId,
        lineas: lines.map((line) => ({
          ean13: line.ean13,
          cantidad: line.cantidad,
        })),
        usuarioId,
      }),
    [lines, providerId, usuarioId],
  );

  async function addProduct(): Promise<void> {
    setMessage(null);
    setErrors({});
    const numericQuantity = Number(quantity);

    if (!isValidEan13(ean13)) {
      setErrors({ ean13: "Ingrese un EAN-13 válido." });
      return;
    }
    if (!Number.isInteger(numericQuantity) || numericQuantity <= 0) {
      setErrors({ cantidad: "La cantidad debe ser un entero mayor que cero." });
      return;
    }
    if (lines.some((line) => line.ean13 === ean13)) {
      setErrors({ ean13: "Cada producto puede aparecer solo una vez." });
      return;
    }

    setAdding(true);
    try {
      const response = await window.appApi.invoke<ActiveProductSearchItem[]>(
        "producto:buscar-activo",
        { ean13, limit: 1, usuarioId },
      );

      if (!response.ok) {
        setMessage(response.error.message);
        return;
      }
      const product = response.data.find((item) => item.ean13 === ean13);
      if (!product) {
        setErrors({
          ean13: "El producto no existe o se encuentra inactivo.",
        });
        return;
      }

      setLines((current) => [
        ...current,
        { ...product, cantidad: String(numericQuantity) },
      ]);
      setEan13("");
      setQuantity("1");
    } catch {
      setMessage("No fue posible consultar el producto. Intente nuevamente.");
    } finally {
      setAdding(false);
    }
  }

  async function saveOrder(): Promise<void> {
    setMessage(null);
    const localErrors = validateSupplierOrderCreatePayload(normalizedPayload);
    if (Object.keys(localErrors).length > 0) {
      setErrors(localErrors);
      setMessage("Revise los campos marcados antes de continuar.");
      return;
    }

    setErrors({});
    setSaving(true);
    try {
      const response = await window.appApi.invoke<SupplierOrderCreateResponse>(
        "pedido:registrar",
        normalizedPayload,
      );

      if (!response.ok) {
        setErrors(response.error.fieldErrors ?? {});
        setMessage(response.error.message);
        return;
      }

      setMessage(
        `Pedido ${shortId(response.data.pedidoId)} registrado en estado Pendiente.`,
      );
      window.setTimeout(() => onNavigate("/app/proveedores/pedidos"), 900);
    } catch {
      setMessage("No fue posible registrar el pedido. Intente nuevamente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="px-8 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold text-[#17202a]">
            Nuevo pedido a proveedor
          </h3>
          <p className="mt-1 text-sm text-[#61717f]">
            Seleccione el proveedor y agregue cada producto una sola vez.
          </p>
        </div>
        <button
          className="rounded-md border border-[#9ba9b5] px-3 py-2 text-sm font-semibold text-[#24313d] hover:bg-[#f0f3f6]"
          type="button"
          onClick={() => onNavigate("/app/proveedores/pedidos")}
        >
          Ver pedidos
        </button>
      </div>

      <section className="mt-5 grid gap-5 rounded-md border border-[#cbd5df] bg-white p-6 shadow-sm">
        <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
          Proveedor
          <select
            className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
            disabled={loadingProviders || providers.length === 0}
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
          >
            <option value="">
              {loadingProviders
                ? "Cargando proveedores..."
                : "Seleccione proveedor"}
            </option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.nombre}
                {provider.rut ? ` - ${provider.rut}` : ""}
              </option>
            ))}
          </select>
          {errors.proveedorId ? <FieldError text={errors.proveedorId} /> : null}
        </label>

        <div className="grid gap-4 rounded-md border border-[#d7dee6] bg-[#f8fafb] p-4 lg:grid-cols-[1fr_220px_auto] lg:items-end">
          <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
            EAN-13 del producto
            <CampoEAN13Input
              disabled={adding}
              value={ean13}
              onChange={setEan13}
              onValidSubmit={() => void addProduct()}
            />
            {errors.ean13 ? <FieldError text={errors.ean13} /> : null}
          </label>
          <label className="grid gap-2 text-sm font-semibold text-[#24313d]">
            Cantidad solicitada
            <input
              className="rounded-md border border-[#9ba9b5] px-3 py-2 font-normal"
              min="1"
              step="1"
              type="number"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
            {errors.cantidad ? <FieldError text={errors.cantidad} /> : null}
          </label>
          <button
            className="rounded-md bg-[#244d61] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1f4354] disabled:bg-[#9ba9b5]"
            disabled={adding}
            type="button"
            onClick={() => void addProduct()}
          >
            {adding ? "Buscando..." : "Agregar producto"}
          </button>
        </div>

        <div className="overflow-x-auto rounded-md border border-[#d7dee6]">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-[#edf1f5] text-left text-[#24313d]">
              <tr>
                <th className="px-4 py-3">Producto</th>
                <th className="px-4 py-3">EAN-13</th>
                <th className="px-4 py-3">Cantidad</th>
                <th className="px-4 py-3 text-right">Acción</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr className="border-t border-[#e3e8ee]" key={line.ean13}>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-[#17202a]">{line.nombre}</p>
                    <p className="text-xs text-[#61717f]">{line.categoria}</p>
                    {errors[`lineas.${index}.ean13`] ? (
                      <FieldError text={errors[`lineas.${index}.ean13`]!} />
                    ) : null}
                  </td>
                  <td className="px-4 py-3">{line.ean13}</td>
                  <td className="px-4 py-3">
                    <input
                      aria-label={`Cantidad de ${line.nombre}`}
                      className="w-28 rounded-md border border-[#9ba9b5] px-3 py-2"
                      min="1"
                      step="1"
                      type="number"
                      value={line.cantidad}
                      onChange={(event) =>
                        setLines((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, cantidad: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                    {errors[`lineas.${index}.cantidad`] ? (
                      <FieldError text={errors[`lineas.${index}.cantidad`]!} />
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      className="font-semibold text-[#9f2d20] hover:underline"
                      type="button"
                      onClick={() =>
                        setLines((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
              {lines.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-[#61717f]" colSpan={4}>
                    Aún no hay productos en el pedido.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {errors.lineas ? <FieldError text={errors.lineas} /> : null}

        {message ? (
          <p className="rounded-md bg-[#edf1f5] px-3 py-2 text-sm font-semibold text-[#24313d]">
            {message}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-3 border-t border-[#e3e8ee] pt-5">
          <button
            className="rounded-md bg-[#2d6a4f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#255a43] disabled:bg-[#9ba9b5]"
            disabled={saving}
            type="button"
            onClick={() => void saveOrder()}
          >
            {saving ? "Guardando..." : "Confirmar pedido"}
          </button>
          <button
            className="rounded-md border border-[#9ba9b5] px-4 py-2 text-sm font-semibold text-[#24313d] hover:bg-[#f0f3f6]"
            type="button"
            onClick={() => onNavigate("/app/inicio")}
          >
            Cancelar
          </button>
        </div>
      </section>
    </section>
  );
}

function FieldError({ text }: { text: string }): ReactElement {
  return <span className="mt-1 text-xs font-semibold text-[#9f2d20]">{text}</span>;
}

function shortId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}
