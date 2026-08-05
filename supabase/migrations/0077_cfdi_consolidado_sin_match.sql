-- 0077 — cfdi_consolidado_linea: el tercer estatus que faltaba, 'sin_match'.
--
-- ═══ EL HUECO QUE DEJÓ LA 0076 ═══════════════════════════════════════════
--
-- La 0076 construyó la cola (`estatus = 'por_conciliar'`) pero no la pantalla
-- para vaciarla — ese es el hallazgo de esta ronda (ver
-- `src/lib/cuadra/intake/consolidado.ts:resolverLineaAMano` y
-- `dashboard/combustible-casetas`). Al construir la resolución a mano
-- apareció un hueco de ESQUEMA, no solo de UI: la 0076 dejó dos estatus,
-- 'conciliada' (gasto_id no nulo, ligada sola o a mano) y 'por_conciliar' (la
-- cola). Lo que no tenía lugar era el tercer desenlace real de una revisión
-- humana: un contador mira los candidatos —o la ausencia de ellos— y
-- concluye que NINGUNO es el gasto correcto. Esa línea no está "conciliada"
-- (no hay gasto_id que ligar) pero tampoco debe seguir en la cola de "por
-- revisar": ya la revisó alguien, y dejarla en 'por_conciliar' la haría
-- reaparecer cada vez que alguien vuelva al panel, como si nunca se hubiera
-- mirado — exactamente la mentira que CLAUDE.md prohíbe ("un rótulo tiene
-- que ser verdad").
--
-- 'sin_match' es esa tercera casilla: documentada (resuelto_por/resuelto_en
-- quedan escritos, igual que en 'conciliada'), sin gasto ligado, y AFUERA del
-- índice parcial `cfdi_consolidado_linea_por_conciliar_idx` (que sigue
-- filtrando solo `estatus = 'por_conciliar'`, sin tocarse) — así que sale de
-- la cola sin que el índice necesite cambiar.
alter table public.cfdi_consolidado_linea drop constraint cfdi_consolidado_linea_estatus_check;
alter table public.cfdi_consolidado_linea add constraint cfdi_consolidado_linea_estatus_check
  check (estatus in ('conciliada', 'por_conciliar', 'sin_match'));

comment on column public.cfdi_consolidado_linea.estatus is
  'conciliada implica gasto_id no nulo Y que gasto.cfdi_uuid/cfdi_orden ya se escribieron. por_conciliar es la cola para un humano. sin_match es la resolucion humana de "ningun gasto capturado corresponde a esta linea" -- documentada (resuelto_por/resuelto_en) pero sin gasto_id, y fuera de la cola (el indice parcial solo cubre por_conciliar).';
