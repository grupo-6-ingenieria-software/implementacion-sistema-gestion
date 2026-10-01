import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import { isValidEan13, normalizeEan13 } from "../../../shared/ean13";
import { findNavNodeByPath } from "../../../shared/navigation";
import type {
  EanCaptureMode, EanCapturePayload, EanCaptureResponse,
  EanFailurePayload, EanFailureResponse, EanModule,
} from "../../../shared/controllers";

type CampoEAN13InputProps = {
  disabled?: boolean;
  value: string;
  onChange: (value: string) => void;
  onValidSubmit?: (value: string) => void | Promise<void>;
  captureMode?: EanCaptureMode;
  modulo?: EanModule;
};

export function CampoEAN13Input({
  disabled = false,
  value,
  onChange,
  onValidSubmit,
  captureMode,
  modulo,
}: CampoEAN13InputProps): ReactElement {
  // La aplicación ya navega por hash. Reutilizarlo evita propagar identidad
  // o configuración del lector por todas las vistas consumidoras.
  const path = typeof window === "undefined" ? "" : window.location.hash.replace(/^#/, "");
  const route = findNavNodeByPath(path);
  const group = route?.group;
  const activeModule = modulo ?? (
    group === "inventario" || group === "ventas" || group === "proveedores" ? group : undefined
  );
  const mode = captureMode ?? (activeModule && route?.id !== "product-create" ? "buscar-producto" : "validar");
  const normalized = normalizeEan13(value);
  const invalid = normalized.length === 13 && !isValidEan13(normalized);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [capturePending, setCapturePending] = useState(false);
  const [reportPending, setReportPending] = useState(false);
  const [reportResult, setReportResult] = useState<{ ok: boolean; message: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const reportButtonRef = useRef<HTMLButtonElement>(null);
  const inputValue = useRef(normalized);
  const revision = useRef(0);
  const attemptedRevision = useRef<number | null>(null);
  const capturing = useRef(false);
  const captureFocus = useRef<{ context: string; trigger: Element | null } | null>(null);
  const reporting = useRef(false);
  const mounted = useRef(true);
  const submitRef = useRef(onValidSubmit);
  submitRef.current = onValidSubmit;
  const contextKey = `${path}:${activeModule}:${mode}`;
  const latestContext = useRef(contextKey);
  latestContext.current = contextKey;
  const errorId = useId();
  const error = invalid ? "Código inválido, intente escanear nuevamente" : captureError;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Un valor precargado o una limpieza del padre no constituye un escaneo.
  useEffect(() => {
    if (inputValue.current !== normalized) {
      inputValue.current = normalized;
      revision.current += 1;
      attemptedRevision.current = null;
      setCaptureError(null);
    }
  }, [normalized]);

  useEffect(() => {
    if (!capturePending && captureFocus.current) {
      const target = captureFocus.current;
      captureFocus.current = null;
      if (latestContext.current === target.context) restoreFocus(target.trigger);
    }
  }, [capturePending]);

  function restoreFocus(button?: Element | null): void {
    const active = document.activeElement;
    if (active === inputRef.current || active === button || active === document.body) {
      inputRef.current?.focus();
    }
  }

  async function submitCapture(code: string, retry = false): Promise<void> {
    if (disabled || capturing.current || inputRef.current?.matches(":disabled")) return;
    if (!isValidEan13(code)) {
      setCaptureError("Código inválido, intente escanear nuevamente");
      return;
    }
    const currentRevision = revision.current;
    if (!retry && attemptedRevision.current === currentRevision) return;
    // Se marca ANTES del primer await: el sufijo Enter pertenece a esta
    // captura incluso si la respuesta IPC ya llegó cuando se pulsa Enter.
    attemptedRevision.current = currentRevision;
    capturing.current = true;
    setCapturePending(true);
    setCaptureError(null);
    const currentContext = contextKey;
    const trigger = document.activeElement;
    try {
      const payload: EanCapturePayload = { value: code, mode };
      const response = await window.appApi.invoke<EanCaptureResponse>("ean:validar-captura", payload);
      if (!mounted.current || latestContext.current !== currentContext || revision.current !== currentRevision) return;
      if (!response.ok) {
        setCaptureError(response.error.message);
        return;
      }
      await submitRef.current?.(response.data.ean13);
    } catch {
      if (mounted.current && latestContext.current === currentContext && revision.current === currentRevision) {
        setCaptureError("No fue posible procesar la captura. Intente nuevamente.");
      }
    } finally {
      capturing.current = false;
      if (mounted.current) {
        captureFocus.current = { context: currentContext, trigger };
        setCapturePending(false);
      }
    }
  }

  async function reportFailure(): Promise<void> {
    if (!activeModule || reporting.current || reportButtonRef.current?.matches(":disabled")) return;
    reporting.current = true;
    setReportPending(true);
    setReportResult(null);
    const currentContext = contextKey;
    try {
      const payload: EanFailurePayload = { modulo: activeModule };
      const response = await window.appApi.invoke<EanFailureResponse>("ean:registrar-fallo", payload);
      if (!mounted.current || latestContext.current !== currentContext) return;
      setReportResult(response.ok
        ? { ok: true, message: "Lectura fallida registrada. Puede reintentar o ingresar el código manualmente." }
        : { ok: false, message: response.error.message });
    } catch {
      if (mounted.current && latestContext.current === currentContext) {
        setReportResult({ ok: false, message: "No fue posible registrar la lectura fallida. Intente nuevamente." });
      }
    } finally {
      reporting.current = false;
      if (mounted.current) {
        setReportPending(false);
        if (latestContext.current === currentContext) restoreFocus(reportButtonRef.current);
      }
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className={`w-full rounded-md border px-3 py-2 disabled:bg-[#edf1f5] disabled:text-[#61717f] ${
          error ? "border-[#b42318]" : "border-[#9ba9b5]"
        }`}
        disabled={disabled || capturePending}
        inputMode="numeric"
        maxLength={13}
        placeholder="EAN-13"
        value={value}
        onChange={(event) => {
          const next = normalizeEan13(event.target.value);
          if (inputValue.current !== next) {
            inputValue.current = next;
            revision.current += 1;
            attemptedRevision.current = null;
            setCaptureError(null);
            setReportResult(null);
          }
          onChange(next);
          if (isValidEan13(next)) void submitCapture(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (inputValue.current) void submitCapture(inputValue.current);
          }
        }}
      />
      {error ? (
        <p id={errorId} role="alert" className="mt-1 text-xs font-medium text-[#b42318]">
          {error}
        </p>
      ) : null}
      {captureError && !invalid ? (
        <button type="button" disabled={disabled || capturePending} className="mt-2 text-xs font-semibold underline"
          onClick={() => void submitCapture(inputValue.current, true)}>
          Reintentar lectura
        </button>
      ) : null}
      {activeModule ? (
        <button ref={reportButtonRef} type="button" disabled={reportPending || capturePending}
          className="mt-2 text-xs font-semibold underline disabled:opacity-50"
          onClick={() => void reportFailure()}>
          {reportPending ? "Reportando lectura fallida..." : "Reportar lectura fallida"}
        </button>
      ) : null}
      {reportResult ? (
        <p role={reportResult.ok ? "status" : "alert"} className={`mt-1 text-xs font-medium ${reportResult.ok ? "text-[#255a43]" : "text-[#b42318]"}`}>
          {reportResult.message}
        </p>
      ) : null}
    </div>
  );
}
