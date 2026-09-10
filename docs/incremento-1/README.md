# Consistencia del incremento 1

La [matriz portable](matriz.json) relaciona 19 requisitos funcionales, 22 casos de uso y 82 escenarios con su especificación, diagrama, vista, canal, controlador, operaciones de modelo y evidencia de prueba. Cada fila distingue consistencia funcional y consistencia de secuencia.

## Decisiones de alcance

- RF39 documenta la extensión de descuento de stock separada del registro de venta de RF36.
- Los nombres de YAML, Drawio y PNG se conservan con sus SHA-256; los artefactos gráficos viven en el repositorio documental y no se duplican aquí.

## Validación

- 372 pruebas automatizadas aprobadas en 48 archivos.
- TypeScript y build aprobados.
- Flujos dedicados de interfaz ejecutados en Chromium para inventario, personal y ventas/caja.
- 82 Drawio auditados por CLI y 82 PNG revisados individualmente; las imágenes que excedían el visor se inspeccionaron mediante copias proporcionales reducidas.

## Índice

- [RF01](RF01.md)
- [RF02](RF02.md)
- [RF03](RF03.md)
- [RF04](RF04.md)
- [RF05](RF05.md)
- [RF06](RF06.md)
- [RF08](RF08.md)
- [RF09](RF09.md)
- [RF10](RF10.md)
- [RF21](RF21.md)
- [RF25](RF25.md)
- [RF29](RF29.md)
- [RF30](RF30.md)
- [RF36](RF36.md)
- [RF39](RF39.md)
- [RF40](RF40.md)
- [RF42](RF42.md)
- [RF55](RF55.md)
- [RF56](RF56.md)
