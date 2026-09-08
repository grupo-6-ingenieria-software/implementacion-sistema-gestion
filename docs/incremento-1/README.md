# Consistencia del incremento 1

22 casos de uso, 82 escenarios y 19 requisitos funcionales. La matriz relaciona cada escenario con su diagrama, vista, canal, controlador, operación de modelo y pruebas.

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

## Decisiones

- Ventas conserva su modelo normalizado; C17 actualiza lote antes de insertar venta_lote dentro de la transacción.
- Pendiente corresponde a planificado; Confirmada corresponde a completada. No se migran estados.
- Se conservan auditoría, usuario_version, movimientos de inventario y eventos.
- El trabajador recibe su propia asistencia; el dueño recibe el resumen global.
- CU7 pertenece al incremento 2. CU56-E1b y las excepciones antiguas de CU29 quedan fuera del conjunto canónico.

## Validación

334 pruebas automatizadas aprobadas, TypeScript y build. Diez comprobaciones de interfaz en Chromium con el límite IPC simulado verifican navegación, confirmaciones y cancelaciones. Las pruebas de integración utilizan SQLite en memoria o archivos temporales.

La verificación documental local comprueba los 82 conjuntos YAML/Draw.io/PNG y sus referencias de código y pruebas. La coincidencia de mensajes no demuestra por sí sola equivalencia semántica. Los PNG se revisan visualmente; las imágenes de gran tamaño se inspeccionan mediante copias reducidas. Los artefactos gráficos permanecen en el repositorio documental y no forman parte de este PR.
