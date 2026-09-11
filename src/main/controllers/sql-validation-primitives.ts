import { sql } from "drizzle-orm";

export type SqlValidationExecutor = Pick<
  typeof import("../../db/client").db,
  "all"
>;
export type SqlScalar = number | string | null;

export function numericSqlValue(value: number): SqlScalar {
  return Number.isFinite(value) ? value : "__invalid_numeric__";
}

export const integerExpression = (value: SqlScalar) => sql<number>`
  typeof(${value}) IN ('integer', 'real')
  AND ${value} = CAST(${value} AS INTEGER)
`;

export const validEanExpression = (ean13: string) => sql<number>`
  CASE WHEN
    typeof(${ean13}) = 'text'
    AND length(trim(${ean13})) = 13
    AND trim(${ean13}) NOT GLOB '*[^0-9]*'
    AND (
      CAST(substr(trim(${ean13}), 1, 1) AS INTEGER) +
      CAST(substr(trim(${ean13}), 2, 1) AS INTEGER) * 3 +
      CAST(substr(trim(${ean13}), 3, 1) AS INTEGER) +
      CAST(substr(trim(${ean13}), 4, 1) AS INTEGER) * 3 +
      CAST(substr(trim(${ean13}), 5, 1) AS INTEGER) +
      CAST(substr(trim(${ean13}), 6, 1) AS INTEGER) * 3 +
      CAST(substr(trim(${ean13}), 7, 1) AS INTEGER) +
      CAST(substr(trim(${ean13}), 8, 1) AS INTEGER) * 3 +
      CAST(substr(trim(${ean13}), 9, 1) AS INTEGER) +
      CAST(substr(trim(${ean13}), 10, 1) AS INTEGER) * 3 +
      CAST(substr(trim(${ean13}), 11, 1) AS INTEGER) +
      CAST(substr(trim(${ean13}), 12, 1) AS INTEGER) * 3 +
      CAST(substr(trim(${ean13}), 13, 1) AS INTEGER)
    ) % 10 = 0
  THEN 1 ELSE 0 END
`;
