-- ═══════════════════════════════════════════════════════════════════════════
-- Epilogo: imprime UNA linea con el JSON de hallazgos y cobertura, y deshace todo.
-- ═══════════════════════════════════════════════════════════════════════════
select 'BANCO_JSON ' || json_build_object(
  'hallazgos', coalesce((select json_agg(json_build_object('tipo', tipo, 'objeto', objeto, 'severidad', severidad, 'detalle', detalle)
                                          order by tipo, objeto) from ci_banco.hallazgos), '[]'::json),
  'cobertura', coalesce((select datos from ci_banco.resumen limit 1), '{}'::jsonb)
)::text;
rollback;
