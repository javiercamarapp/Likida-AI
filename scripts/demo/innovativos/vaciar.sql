-- ═══════════════════════════════════════════════════════════════════════════
-- vaciar.sql — quita el dato SINTÉTICO de UN conjunto del demo para que entre
-- el real de Innovativos (docs/demo/innovativos.md). Solo toca el tenant demo y
-- SOLO las filas que sembró el demo: cada DELETE/UPDATE se acota por la marca del demo (proveedor/origen
-- «(demo)», nombres «Demo», o los ids deterministas de innovativos_sim.uid), nunca «todo lo del tenant». Lo real que
-- ya se haya cargado (sitios con fuente csv, posiciones de su tabla, contactos y mensajes de Vigía) NO se toca.
-- Lo prueba probar-vaciar-solo-sembrado.sh. Uso (lo arma vaciar-sintetico.sh):
--   psql -v que=gps|geocercas|pases|liquidaciones|cartaporte|vigia|convenios|todo -f vaciar.sql
-- Re-sembrar (sembrar.sh) lo vuelve a poner idéntico.
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\if :{?red_privada}
\else
  \set red_privada 0
\endif
select set_config('inn.red_privada', :'red_privada', false) \g /dev/null
\set t 'eeeeeeee-0620-4000-8000-000000000250'

do $$
declare ip inet := inet_server_addr(); n text;
begin
  if not (ip is null or ip <<= '127.0.0.0/8'::inet or ip = '::1'::inet
          or (current_setting('inn.red_privada', true) = '1'
              and (ip <<= '10.0.0.0/8'::inet or ip <<= '172.16.0.0/12'::inet or ip <<= '192.168.0.0/16'::inet))) then
    raise exception 'DEMO INNOVATIVOS: el servidor no es loopback (las redes privadas piden DEMO_PERMITIR_RED_PRIVADA=1); no se vacía nada.';
  end if;
  if current_database() ~* 'prod' then
    raise exception 'DEMO INNOVATIVOS: la base se llama «%» (parece de producción). No se vacía nada.', current_database();
  end if;
  select nombre into n from tenant where id = 'eeeeeeee-0620-4000-8000-000000000250';
  if n is distinct from 'Innovativos (demo)' then
    raise exception 'el tenant demo no existe o no se llama «Innovativos (demo)» (%)', n;
  end if;
end $$;

select :'que' in ('gps', 'todo') as es_gps, :'que' in ('geocercas', 'todo') as es_geo, :'que' in ('pases', 'todo') as es_pases,
       :'que' in ('liquidaciones', 'todo') as es_liq, :'que' in ('cartaporte', 'todo') as es_cp,
       :'que' in ('vigia', 'todo') as es_vigia, :'que' in ('convenios', 'todo') as es_conv,
       :'que' in ('gps', 'geocercas', 'pases', 'liquidaciones', 'cartaporte', 'vigia', 'convenios', 'todo') as es_valido \gset

\if :es_valido
\else
  \echo 'ERROR: «que» debe ser gps | geocercas | pases | liquidaciones | cartaporte | vigia | convenios | todo'
  \quit 2
\endif

\if :es_gps
  -- Marca de la posición sembrada: proveedor tabla_propia, de uno de los 250 tractos sembrados, recibida EXACTAMENTE
  -- 20 s después de medida (03_gps.sql). Una posición real del mismo proveedor llega con otro desfase y no se toca.
  delete from posicion p where p.tenant_id = :'t' and p.proveedor = 'tabla_propia'
    and p.recibida_en - p.medida_en = interval '20 seconds'
    and p.unidad_id in (select innovativos_sim.uid('unidad:' || g) from generate_series(1, 250) g);
  update unidad set gps_visto_en = null
    where tenant_id = :'t' and id in (select innovativos_sim.uid('unidad:' || g) from generate_series(1, 250) g);
  \echo 'gps: posiciones sintéticas (las 250 unidades sembradas, proveedor tabla_propia) borradas. La tabla simulada innovativos_sim queda (es «su» tabla de prueba).'
\endif
\if :es_geo
  -- Solo los 3 patios, las 14 plantas y los 14 andenes que sembró el demo (por id determinista), no «todo lo csv».
  delete from geocerca g where g.tenant_id = :'t' and g.id in (
    select innovativos_sim.uid('geo:patio:' || c) from unnest(array['GDL', 'SIL', 'APO']) c
    union all select innovativos_sim.uid('geo:planta:c' || lpad(n::text, 2, '0')) from generate_series(1, 14) n
    union all select innovativos_sim.uid('geo:anden:c' || lpad(n::text, 2, '0')) from generate_series(1, 14) n);
  \echo 'geocercas: las sembradas borradas (viaje, cliente y andén quedan sin referencia; re-sembrar las restaura; el catálogo real entra por Sitios y no se toca).'
\endif
\if :es_pases
  delete from desglose_peaje where tenant_id = :'t' and proveedor = 'PASE (demo)';
  delete from peaje_curso where tenant_id = :'t' and codigo like 'CUR-DEMO-%';
  delete from peaje_tag where tenant_id = :'t' and proveedor = 'PASE (demo)';
  delete from peaje_caseta where tenant_id = :'t' and nombre like 'Caseta Demo %';
  \echo 'pases: desglose, líneas, TAG, casetas y cursos sintéticos borrados.'
\endif
\if :es_liq
  delete from liquidacion_externa where tenant_id = :'t' and sistema_origen = 'SAP (demo)';
  \echo 'liquidaciones: las de «SAP (demo)» borradas.'
\endif
\if :es_cp
  delete from cp_documento where tenant_id = :'t' and modelo = 'demo-sintetico';
  delete from cp_export_config where tenant_id = :'t' and nombre like '%(demo%';
  delete from cp_perfil where tenant_id = :'t' and clave like '%-demo';
  \echo 'cartaporte: documentos, perfiles y formato de exportación sintéticos borrados.'
\endif
\if :es_vigia
  -- Solo los 3 contactos críticos, sus conversaciones y sus 6 mensajes sembrados (ids deterministas). Un contacto o
  -- una conversación sembrados que ya tengan mensajes REALES colgando no se borran.
  delete from vigia_mensaje where tenant_id = :'t' and id in (
    select innovativos_sim.uid('vigiamsg:' || c || ':' || n) from unnest(array['c05', 'c10', 'c12']) c cross join generate_series(1, 3) n);
  delete from vigia_conversacion v where v.tenant_id = :'t'
    and v.id in (select innovativos_sim.uid('vigiaconv:' || c) from unnest(array['c05', 'c10', 'c12']) c)
    and not exists (select 1 from vigia_mensaje m where m.conversacion_id = v.id);
  delete from vigia_contacto v where v.tenant_id = :'t'
    and v.id in (select innovativos_sim.uid('vigiacontacto:' || c) from unnest(array['c05', 'c10', 'c12']) c)
    and not exists (select 1 from vigia_conversacion x where x.contacto_id = v.id);
  -- Los 3 grupos críticos sembrados (con su histórico importado, en cascada) y las respuestas rápidas aprobadas que salieron de él.
  delete from vigia_grupo where tenant_id = :'t'
    and id in (select innovativos_sim.uid('vigiagrupo:' || c) from unnest(array['c05', 'c10', 'c12']) c);
  delete from vigia_respuesta_rapida where tenant_id = :'t'
    and id in (select innovativos_sim.uid('respuestarapida:' || n) from generate_series(1, 10) n);
  \echo 'vigia: los contactos, conversaciones, mensajes, grupos, histórico y respuestas rápidas sembrados borrados (lo real que se haya cargado queda).'
\endif
\if :es_conv
  do $$ begin
    if to_regclass('public.cliente_convenio') is not null then
      delete from public.cliente_convenio where tenant_id = 'eeeeeeee-0620-4000-8000-000000000250'
        and id in (select innovativos_sim.uid('convenio:' || clave) from innovativos_sim.convenio);
    end if;
  end $$;
  \echo 'convenios: los sembrados en public.cliente_convenio (si la 0580 está) borrados; innovativos_sim.convenio* queda como copia de su sistema.'
\endif
