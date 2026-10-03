-- ═══════════════════════════════════════════════════════════════════════════
-- 08 — Convenios de cliente, tarifa e INSTRUCCIONES DE OPERACIÓN («calle de
-- instrucciones»): qué puerta, con quién reportarse, peculiaridades.
--
-- El modelo cliente→convenio→instrucciones es el del producto (migración 0580:
-- cliente_convenio, convenio_instruccion, convenio_comercial). Este seed hace DOS cosas:
--   1) deja SIEMPRE los datos en innovativos_sim.convenio* (la «copia de su
--      sistema»; sirve de fuente para convenios.csv);
--   2) SI las tablas de la 0580 existen en esta base (en una base migrada hasta la
--      0652 siempre), los carga también en ellas, con ids deterministas. Si no
--      existen, avisa y sigue: no rompe el seed y no inventa tablas ajenas.
-- ═══════════════════════════════════════════════════════════════════════════

drop table if exists innovativos_sim.convenio_instruccion, innovativos_sim.convenio_comercial, innovativos_sim.convenio cascade;
create table innovativos_sim.convenio as
select 'conv-' || s.cliente_key as clave, s.cliente_key, s.nombre_cliente as cliente,
       s.nombre_cliente || ': ' || s.planta || ' → ' || d.planta as nombre,
       s.planta || ', ' || s.ciudad as origen, d.planta || ', ' || d.ciudad as destino, d.cliente_key as destino_key
from innovativos_sim.sitio s
cross join lateral (select x.* from innovativos_sim.sitio x where x.nodo <> s.nodo
                    order by md5('conv' || s.cliente_key || x.cliente_key) limit 1) d;

create table innovativos_sim.convenio_instruccion as
select c.clave, i.categoria, i.momento, i.orden,
       replace(replace(i.texto, '{planta}', s.planta), '{puerta}', (1 + innovativos_sim.h(c.clave || i.categoria) % 6)::text) as texto
from innovativos_sim.convenio c
join innovativos_sim.sitio s on s.cliente_key = c.cliente_key
cross join (values
  ('puerta',       'ambos',        1, 'Entrar a {planta} por la puerta {puerta} de la calle lateral, no por la entrada principal.'),
  ('reportarse',   'acercamiento', 2, 'Reportarse en vigilancia con la carta porte impresa y pedir pase a andén (contacto ficticio de demo).'),
  ('peculiaridad', 'acercamiento', 3, 'No se permite descargar con lluvia sin lona; el patio de maniobras no admite teléfonos en mano.'),
  ('documentos',   'despacho',     4, 'Llevar remisión por triplicado y copia de la Carta Porte; el recibo sellado es requisito de cobro.'),
  ('horario',      'despacho',     5, 'Recibo de 06:00 a 14:00 de lunes a sábado; fuera de horario la unidad espera en el patio del cliente.'),
  ('seguridad',    'ambos',        6, 'Candado de sello obligatorio; fotografiar el sello al llegar y al salir.')
) i(categoria, momento, orden, texto);

create table innovativos_sim.convenio_comercial as
select c.clave, (array['por_km', 'por_viaje', 'por_tonelada'])[innovativos_sim.pick('tm' || c.clave, 3)] as tarifa_modo,
       (case innovativos_sim.pick('tm' || c.clave, 3) when 1 then 31 + innovativos_sim.h('tp' || c.clave) % 12
                                                       when 2 then 14000 + innovativos_sim.h('tp' || c.clave) % 12000
                                                       else 650 + innovativos_sim.h('tp' || c.clave) % 300 end)::numeric(12,2) as tarifa_precio,
       array['Remisión sellada', 'Carta Porte timbrada', 'Orden de compra del cliente'] as requisitos_cobro
from innovativos_sim.convenio c;

do $$
declare
  t uuid := current_setting('inn.tenant')::uuid;
begin
  if to_regclass('public.cliente_convenio') is null
     or to_regclass('public.convenio_instruccion') is null
     or to_regclass('public.convenio_comercial') is null then
    raise warning 'convenios: las tablas de la 0580 no existen en esta base (¿migraciones sin aplicar?); los datos quedan solo en innovativos_sim.convenio*.';
    return;
  end if;

  insert into public.cliente_convenio (id, tenant_id, cliente_id, nombre, origen, destino, origen_sitio_id, destino_sitio_id, vigente_desde, activo, notas)
  select innovativos_sim.uid('convenio:' || c.clave), t, innovativos_sim.uid('cliente:' || c.cliente_key), left(c.nombre, 120),
         left(c.origen, 160), left(c.destino, 160),
         innovativos_sim.uid('geo:planta:' || c.cliente_key), innovativos_sim.uid('geo:planta:' || c.destino_key),
         (current_setting('inn.ancla')::timestamptz)::date - 90, true, 'Convenio sintético de demo.'
  from innovativos_sim.convenio c
  on conflict (id) do nothing;

  insert into public.convenio_instruccion (id, tenant_id, convenio_id, categoria, texto, momento, orden, activa)
  select innovativos_sim.uid('convinstr:' || i.clave || ':' || i.categoria), t, innovativos_sim.uid('convenio:' || i.clave),
         i.categoria, left(i.texto, 400), i.momento, i.orden, true
  from innovativos_sim.convenio_instruccion i
  on conflict (id) do nothing;

  insert into public.convenio_comercial (convenio_id, tenant_id, tarifa_modo, tarifa_precio, tarifa_moneda, requisitos_cobro)
  select innovativos_sim.uid('convenio:' || m.clave), t, m.tarifa_modo, m.tarifa_precio, 'MXN', m.requisitos_cobro
  from innovativos_sim.convenio_comercial m
  on conflict (convenio_id) do nothing;
end $$;
