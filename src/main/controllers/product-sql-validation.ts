import { sql } from "drizzle-orm";
import { invalidEan13Message, type ProductFieldErrors, type ProductFormValues } from "../../shared/products";
import { integerExpression, numericSqlValue, validEanExpression, type SqlValidationExecutor } from "./sql-validation-primitives";

export async function validateProductInSql(
  executor: SqlValidationExecutor,
  values: ProductFormValues,
  originalEan13?: string,
): Promise<ProductFieldErrors> {
  const cost = numericSqlValue(values.precioCosto);
  const sale = numericSqlValue(values.precioVenta);
  const stock = numericSqlValue(values.stockMinimo);
  const category = numericSqlValue(values.categoriaId);
  const [result] = await executor.all<{
    ean13Valid: number; ean13Unchanged: number; nameValid: number;
    categoryValid: number; costValid: number; saleValid: number;
    marginValid: number; stockValid: number;
  }>(sql`SELECT
    ${validEanExpression(values.ean13)} AS ean13Valid,
    CASE WHEN ${originalEan13 ?? values.ean13} = ${values.ean13} THEN 1 ELSE 0 END AS ean13Unchanged,
    CASE WHEN typeof(${values.nombre}) = 'text' AND length(trim(${values.nombre})) > 0 THEN 1 ELSE 0 END AS nameValid,
    CASE WHEN ${integerExpression(category)} AND ${category} > 0 THEN 1 ELSE 0 END AS categoryValid,
    CASE WHEN ${integerExpression(cost)} AND ${cost} >= 0 THEN 1 ELSE 0 END AS costValid,
    CASE WHEN ${integerExpression(sale)} AND ${sale} >= 0 THEN 1 ELSE 0 END AS saleValid,
    CASE WHEN ${integerExpression(cost)} AND ${integerExpression(sale)} AND ${sale} > ${cost} THEN 1 ELSE 0 END AS marginValid,
    CASE WHEN ${integerExpression(stock)} AND ${stock} >= 0 THEN 1 ELSE 0 END AS stockValid`);
  const errors: ProductFieldErrors = {};
  if (!result.ean13Valid) errors.ean13 = invalidEan13Message;
  else if (!result.ean13Unchanged) errors.ean13 = "El codigo EAN-13 no se puede modificar al editar.";
  if (!result.nameValid) errors.nombre = "El nombre del producto es obligatorio.";
  if (!result.categoryValid) errors.categoriaId = "Seleccione una categoria valida.";
  if (!result.costValid) errors.precioCosto = "El precio costo debe ser un entero mayor o igual a 0.";
  if (!result.saleValid) errors.precioVenta = "El precio venta debe ser un entero mayor o igual a 0.";
  else if (!result.marginValid) errors.precioVenta = "El precio venta debe ser mayor que el precio costo.";
  if (!result.stockValid) errors.stockMinimo = "El stock minimo debe ser un entero mayor o igual a 0.";
  return errors;
}
