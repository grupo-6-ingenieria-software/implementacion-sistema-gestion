import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import {
  formatChileanPeso,
  parseSaleDiscountAmount,
  validateSaleDiscount,
  type SaleDiscountErrors,
  type SaleDiscountInput,
} from "../../../shared/sales";

type Props = {
  subtotal: number;
  descuento: SaleDiscountInput | null;
  onApply: (discount: SaleDiscountInput | null) => void;
  onClose: () => void;
};

/** UI04: borrador local; nunca registra una venta ni invoca IPC. */
export function DescuentoVentaModal({
  subtotal,
  descuento,
  onApply,
  onClose,
}: Props): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const [amount, setAmount] = useState(
    descuento ? String(descuento.monto) : "",
  );
  const [reason, setReason] = useState(descuento?.razon ?? "");
  const [errors, setErrors] = useState<SaleDiscountErrors>({});
  const parsed = parseSaleDiscountAmount(amount);
  const needsReason = parsed !== null && parsed > 0;

  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current!;
    dialog.showModal();
    amountRef.current?.focus();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);

  function apply(): void {
    const nextErrors = validateSaleDiscount(parsed, reason, subtotal);
    setErrors(nextErrors);
    if (nextErrors.monto) {
      amountRef.current?.focus();
      return;
    }
    if (nextErrors.razon) {
      reasonRef.current?.focus();
      return;
    }
    onApply(parsed === 0 ? null : { monto: parsed!, razon: reason.trim() });
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${id}-title`}
      aria-modal="true"
      className="m-auto w-[calc(100%_-_2rem)] max-w-md rounded-md border border-[#cbd5df] bg-white p-6 text-[#24313d] shadow-xl backdrop:bg-black/40"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = event.currentTarget.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), textarea:not([disabled])",
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
        noValidate
      >
        <div className="flex items-center justify-between gap-3">
          <h3
            id={`${id}-title`}
            className="text-lg font-semibold text-[#17202a]"
          >
            Aplicar descuento
          </h3>
          <button
            type="button"
            aria-label="Cerrar descuento"
            onClick={onClose}
            className="rounded-md px-3 py-2"
          >
            ✕
          </button>
        </div>
        <p className="mt-3 text-sm">Subtotal: {formatChileanPeso(subtotal)}</p>
        <label
          className="mt-4 grid gap-1 text-sm font-semibold"
          htmlFor={`${id}-amount`}
        >
          Monto del descuento
        </label>
        <input
          ref={amountRef}
          id={`${id}-amount`}
          inputMode="numeric"
          value={amount}
          aria-invalid={Boolean(errors.monto)}
          aria-describedby={`${id}-help ${id}-amount-error`}
          onChange={(event) => {
            setAmount(event.target.value);
            setErrors({});
          }}
          className="mt-1 w-full rounded-md border border-[#9ba9b5] px-3 py-2"
        />
        <p id={`${id}-help`} className="mt-1 text-xs text-[#61717f]">
          Pesos enteros, por ejemplo 1500 o 1.500. Ingrese 0 para quitar el
          descuento.
        </p>
        <p
          id={`${id}-amount-error`}
          role={errors.monto ? "alert" : undefined}
          className="mt-1 text-sm text-[#b42318]"
        >
          {errors.monto}
        </p>
        {needsReason ? (
          <>
            <label
              className="mt-4 grid gap-1 text-sm font-semibold"
              htmlFor={`${id}-reason`}
            >
              Razón del descuento (obligatoria)
            </label>
            <textarea
              ref={reasonRef}
              id={`${id}-reason`}
              value={reason}
              rows={3}
              aria-invalid={Boolean(errors.razon)}
              aria-describedby={`${id}-reason-error`}
              onChange={(event) => {
                setReason(event.target.value);
                setErrors({});
              }}
              className="mt-1 w-full rounded-md border border-[#9ba9b5] px-3 py-2"
            />
            <p
              id={`${id}-reason-error`}
              role={errors.razon ? "alert" : undefined}
              className="mt-1 text-sm text-[#b42318]"
            >
              {errors.razon}
            </p>
          </>
        ) : null}
        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[#9ba9b5] px-4 py-2 font-semibold"
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="rounded-md bg-[#244d61] px-4 py-2 font-semibold text-white"
          >
            Aplicar
          </button>
        </div>
      </form>
    </dialog>
  );
}
