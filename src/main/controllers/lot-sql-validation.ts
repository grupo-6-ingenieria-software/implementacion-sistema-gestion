import { sql } from "drizzle-orm";
import type { LotFieldErrors, LotRegisterPayload } from "../../shared/lots";
import { integerExpression, numericSqlValue, validEanExpression, type SqlValidationExecutor } from "./sql-validation-primitives";

export async function validateLotBasicsInSql(
  executor: SqlValidationExecutor,
  values: LotRegisterPayload,
): Promise<LotFieldErrors> {
  const quantity = numericSqlValue(values.cantidad);
  const cost = numericSqlValue(values.precioCosto);
  const provider = numericSqlValue(values.proveedorId);
  const [result] = await executor.all<{
    ean13Valid: number; quantityValid: number; costValid: number; providerValid: number;
  }>(sql`SELECT
    ${validEanExpression(values.ean13)} AS ean13Valid,
    CASE WHEN ${integerExpression(quantity)} AND ${quantity} > 0 THEN 1 ELSE 0 END AS quantityValid,
    CASE WHEN ${integerExpression(cost)} AND ${cost} > 0 THEN 1 ELSE 0 END AS costValid,
    CASE WHEN ${integerExpression(provider)} AND ${provider} > 0 THEN 1 ELSE 0 END AS providerValid`);
  const errors: LotFieldErrors = {};
  if (!result.ean13Valid) errors.ean13 = "Seleccione un producto activo para registrar el lote.";
  if (!result.quantityValid) errors.cantidad = "La cantidad debe ser un entero mayor que 0.";
  if (!result.costValid) errors.precioCosto = "El costo del lote debe ser un entero mayor que 0.";
  if (!result.providerValid) errors.proveedorId = "Seleccione un proveedor existente.";
  return errors;
}

export async function validateLotExpirationInSql(
  executor: SqlValidationExecutor,
  values: LotRegisterPayload,
  productRequiresExpiration: boolean,
  today: string,
): Promise<LotFieldErrors> {
  const expiration = values.fechaVencimiento ?? null;
  const [result] = await executor.all<{
    expirationPresent: number;
    expirationFormatValid: number;
    expirationFuture: number;
  }>(sql`SELECT
    CASE WHEN typeof(${expiration}) = 'text' AND length(${expiration}) > 0 THEN 1 ELSE 0 END AS expirationPresent,
    CASE WHEN typeof(${expiration}) = 'text'
      AND ${expiration} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(${expiration}, '+0 days') = ${expiration}
      THEN 1 ELSE 0 END AS expirationFormatValid,
    CASE WHEN date(${expiration}, '+0 days') > date(${today}, '+0 days') THEN 1 ELSE 0 END AS expirationFuture`);
  if (!productRequiresExpiration) return {};
  if (!result.expirationPresent) {
    return { fechaVencimiento: "La fecha de vencimiento es obligatoria para esta categoria." };
  }
  if (!result.expirationFormatValid) {
    return { fechaVencimiento: "Ingrese una fecha de vencimiento valida." };
  }
  return result.expirationFuture
    ? {}
    : { fechaVencimiento: "La fecha de vencimiento debe ser posterior a hoy." };
}
