-- ═══════════════════════════════════════════════════════════════════════════
-- LA TABLA QUE MÁS PARECE VIVA ES LA MUERTA.
--
-- `politica_gasto` tiene un `tope_monto` por concepto y un `requiere_cfdi`. Se
-- llama como lo que hace. El seed la llenaba con topes y afirmaba por escrito
-- que "el motor de cuadre usa tope_monto y requiere_cfdi".
--
-- No lo usa. La política viva sale de `tenant.config.politica` (config.ts →
-- cuadrarDesdeDB → cuadrarViaje). `getPolitica`, su único lector, no tenía un
-- solo llamador y se borró el 31-jul.
--
-- El daño no es el código muerto, es el señuelo: un contralor que quiera bajarle
-- el tope de diésel a su flota abre Supabase, encuentra exactamente la tabla que
-- busca, la edita — y las liquidaciones siguen igual. Sin error, sin aviso, y
-- creyendo que su política está aplicada.
--
-- La 0025 ya lo documentó en el comentario de su check de dominio, pero eso no
-- se ve desde ningún lado: los comentarios de las migraciones viven en el repo.
-- `comment on table` SÍ se ve en el explorador de Supabase, que es donde está
-- parado quien va a caer en la trampa.
--
-- No se DROPEA: el check de dominio de la 0025 la deja lista por si algún día la
-- política se mueve del jsonb a su tabla, que es a donde debería ir cuando haya
-- más de un cliente. Hasta entonces, que diga lo que es.
-- ═══════════════════════════════════════════════════════════════════════════

comment on table politica_gasto is
  'MUERTA — no la lee nadie. La política de gastos viva sale de tenant.config.politica (ver DEMO_CONFIG en src/lib/cuadra/config.ts). Cambiar un tope AQUÍ no cambia ninguna liquidación. Se conserva con su check de dominio (mig. 0025) por si la política se mueve algún día del jsonb a esta tabla.';

comment on column politica_gasto.tope_monto is
  'NO se aplica. El tope vivo es tenant.config.politica[].topeMonto.';
