import { sql } from "drizzle-orm";
import {
  invalidWasteEanMessage,
  type WasteFieldErrors,
  type WasteRegisterPayload,
} from "../../shared/waste";
import {
  integerExpression,
  numericSqlValue,
  validEanExpression,
  type SqlValidationExecutor,
} from "./sql-validation-primitives";

export async function validateWasteInSql(
  executor: SqlValidationExecutor,
  values: WasteRegisterPayload,
  stockDisponible: number,
): Promise<{ errors: WasteFieldErrors; stockInsufficient: boolean }> {
  const quantity = numericSqlValue(values.cantidad);
  const observation = values.observacion ?? null;
  const userId = values.usuarioId ?? null;
  const [result] = await executor.all<{
    ean13Valid: number;
    quantityValid: number;
    stockValid: number;
    reasonValid: number;
    observationValid: number;
    userValid: number;
  }>(sql`SELECT
    ${validEanExpression(values.ean13)} AS ean13Valid,
    CASE WHEN ${integerExpression(quantity)} AND ${quantity} > 0 THEN 1 ELSE 0 END AS quantityValid,
    CASE WHEN ${integerExpression(quantity)} AND ${quantity} > 0 AND ${quantity} <= ${stockDisponible} THEN 1 ELSE 0 END AS stockValid,
    CASE WHEN ${values.motivo} IN ('vencimiento', 'dano', 'robo', 'error_registro') THEN 1 ELSE 0 END AS reasonValid,
    CASE WHEN ${observation} IS NULL OR (typeof(${observation}) = 'text' AND length(${observation}) <= 200) THEN 1 ELSE 0 END AS observationValid,
    CASE WHEN typeof(${userId}) = 'text' AND length(trim(${userId})) > 0 THEN 1 ELSE 0 END AS userValid`);
  const errors: WasteFieldErrors = {};
  if (!result.ean13Valid) errors.ean13 = invalidWasteEanMessage;
  if (!result.quantityValid)
    errors.cantidad = "La cantidad debe ser un entero mayor que 0.";
  else if (!result.stockValid)
    errors.cantidad = `La cantidad no puede superar el stock disponible (${stockDisponible}).`;
  if (!result.reasonValid)
    errors.motivo = "Seleccione un motivo de merma valido.";
  if (!result.observationValid)
    errors.observacion = "La observacion no puede superar 200 caracteres.";
  if (!result.userValid)
    errors.usuarioId = "No hay un usuario responsable para registrar la merma.";
  return {
    errors,
    stockInsufficient: Boolean(result.quantityValid && !result.stockValid),
  };
}
