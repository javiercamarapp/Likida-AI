-- 0073 — `comprobante_huerfano`: la FK compuesta que se saltó, y sus dominios.
--
-- ═══ 1. LA FK COMPUESTA QUE FALTÓ (auditoría, MEDIO) ═════════════════════
--
-- La 0028 documentó como CRÍTICA la clase de defecto: con una FK simple contra
-- `operador(id)`, nada impide que una fila lleve el `tenant_id` de la flota A y
-- el `operador_id` de la flota B. `comprobante_huerfano` nació en la 0040 —
-- DESPUÉS de la 0028 — y se saltó el patrón.
--
-- Comprobado contra esta base ANTES de arreglarlo: una fila con `tenant_id` de
-- una flota y `operador_id` de otra ENTRABA.
--
-- Hoy no hay camino de usuario que lo produzca: `guardarHuerfano()` recibe los
-- dos identificadores de la misma sesión de operador. Eso lo hace MEDIO y no
-- CRÍTICO — pero es exactamente el argumento que la 0028 rechazó, porque el
-- valor de la restricción no es tapar el camino de hoy sino que el de mañana no
-- pueda abrirse en silencio. En una base multi-tenant, la fila mal atribuida se
-- lee como dato bueno de la flota equivocada.
--
-- Se AGREGA la compuesta y se DEJA la simple, igual que en `gasto` y
-- `codigo_pendiente` (0028): son restricciones distintas, no una sustituye a la
-- otra. Se apoya en `operador_id_tenant_key`, que la 0028 ya había creado.
--
-- NO se le pone la compuesta a `viaje_id`. Su FK es `ON DELETE SET NULL`, y una
-- compuesta `(viaje_id, tenant_id)` intentaría poner NULL en las DOS columnas al
-- borrar el viaje — pero `tenant_id` es NOT NULL, así que el borrado del viaje
-- reventaría. Es una trampa real, no una omisión.

alter table public.comprobante_huerfano
  add constraint comprobante_huerfano_operador_tenant_fkey
  foreign key (operador_id, tenant_id)
  references public.operador (id, tenant_id)
  on delete cascade;

-- ═══ 2. LOS DOS ÚNICOS DOMINIOS DE ESTADO SIN CHECK ══════════════════════
--
-- `motivo` y `resolucion` eran las DOS únicas columnas de estado del esquema sin
-- su check, aunque la 0040 las documenta y el código ramifica sobre ellas. Todo
-- lo demás ya lo tiene: `viaje.estatus`, `liquidacion.estatus`, `gasto.concepto`,
-- `gasto.estado_sat`, `pod.estado`, `unidad.estado`, `incidencia.tipo`/`estado`/
-- `prioridad`, `ticket_soporte.estado`/`categoria`/`prioridad`,
-- `cotizacion.estado`, `factura_emitida.estatus`, `llm_costo.fase`, `tarifa.modo`.
--
-- LOS VALORES SE TOMARON DEL CÓDIGO DE HOY, no de la 0040. La migración vieja
-- documenta solo dos motivos, pero `src/lib/cuadra/repo.ts` ya declara TRES:
--
--     export type MotivoHuerfano = 'sin_viaje' | 'tras_liquidar' | 'fallo_ocr';
--                                                                  ↑ repo.ts:257
--
-- `fallo_ocr` es nuevo —separa "se cayó NUESTRO OCR" de "no aterrizó en ninguna
-- liquidación", que antes se guardaban los dos como `sin_viaje`— y cerrar el
-- dominio contra la 0040 lo habría roto. Se verificó el árbol de trabajo antes
-- de escribir esto, no la migración que lo documentaba.
--
--     resolucion: 'adjuntado' | 'descartado'   ← repo.ts:326, y admite NULL
--                                                (NULL = todavía sin resolver)

alter table public.comprobante_huerfano
  add constraint comprobante_huerfano_motivo_dominio
  check (motivo in ('sin_viaje', 'tras_liquidar', 'fallo_ocr'));

alter table public.comprobante_huerfano
  add constraint comprobante_huerfano_resolucion_dominio
  check (resolucion is null or resolucion in ('adjuntado', 'descartado'));

-- Y la coherencia entre las dos columnas de cierre: `resuelto_en` y `resolucion`
-- se escriben juntas en `resolverHuerfanos()`, así que una sin la otra es una
-- fila a medias. Mismo criterio que `incidencia_cierre_coherente` (0051) y
-- `ticket_cierre_coherente`.
alter table public.comprobante_huerfano
  add constraint comprobante_huerfano_cierre_coherente
  check ((resuelto_en is not null) = (resolucion is not null));
