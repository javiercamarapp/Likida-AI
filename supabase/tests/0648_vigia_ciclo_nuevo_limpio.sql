\set ON_ERROR_STOP on
-- 0648 — un ciclo de espera NUEVO del Vigía nace sin la escalera ni la molestia del anterior, contra Postgres REAL.
-- Escenario de la carrera: el barrido escribió nivel/molestia sobre un hilo que el gerente ya había contestado
-- (`sin_respuesta_desde` en null); el cliente vuelve a escribir y el ciclo nuevo NO debe heredarlos. Y un ciclo en curso
-- sí conserva lo suyo (un segundo mensaje no reinicia la escalera).
begin;

insert into public.tenant (id, nombre) values ('64800000-0000-4000-8000-0000000000a1', 'Flota A 0648');
insert into public.cliente (id, tenant_id, nombre) values ('64800000-0000-4000-8000-0000000000a2', '64800000-0000-4000-8000-0000000000a1', 'Cliente A');
insert into public.vigia_contacto (id, tenant_id, cliente_id, telefono, telefono_hash, nombre, consentimiento_en, consentimiento_origen)
values ('64800000-0000-4000-8000-0000000000d1', '64800000-0000-4000-8000-0000000000a1', '64800000-0000-4000-8000-0000000000a2',
        '525548010001', repeat('a', 64), 'Compras A', now(), 'alta_flota');

do $$
declare
  t constant uuid := '64800000-0000-4000-8000-0000000000a1';
  c constant uuid := '64800000-0000-4000-8000-0000000000d1';
  r record; v record;
begin
  perform * from public.vigia_recibir_mensaje(t, c, 'wamid.0648.1', 'texto', 'hola', now() - interval '20 minutes');
  -- El barrido sube el nivel de un ciclo que sigue vivo; un segundo mensaje NO lo reinicia.
  update public.vigia_conversacion set escalamiento_nivel = 1, escalado_en = now(), molestia_nivel = 2, molestia_motivos = '{espera}', molestia_en = now()
   where contacto_id = c and estado = 'activa';
  perform * from public.vigia_recibir_mensaje(t, c, 'wamid.0648.2', 'texto', '¿alguien?', now());
  select * into v from public.vigia_conversacion where contacto_id = c and estado = 'activa';
  if v.escalamiento_nivel <> 1 or v.molestia_nivel <> 2 or v.escalado_en is null then
    raise exception '0648: un segundo mensaje del MISMO ciclo reinició la escalera (nivel %, molestia %)', v.escalamiento_nivel, v.molestia_nivel;
  end if;

  -- El gerente contesta (lo que hace marcarRespondida) y el barrido, con su lectura vieja, escribe el nivel justo después.
  update public.vigia_conversacion set sin_respuesta_desde = null, entradas_sin_respuesta = 0, escalamiento_nivel = 0, molestia_nivel = 0, molestia_motivos = '{}', escalado_en = null, molestia_en = null
   where id = v.id;
  update public.vigia_conversacion set escalamiento_nivel = 2, escalado_en = now(), molestia_nivel = 3, molestia_motivos = '{espera}', molestia_en = now() where id = v.id;

  -- El cliente escribe otra vez: ciclo nuevo, limpio.
  select * into r from public.vigia_recibir_mensaje(t, c, 'wamid.0648.3', 'texto', 'de nuevo', now());
  select * into v from public.vigia_conversacion where id = v.id;
  if v.escalamiento_nivel <> 0 or v.escalado_en is not null or v.molestia_nivel <> 0 or v.molestia_motivos <> '{}' or v.molestia_en is not null then
    raise exception '0648: el ciclo nuevo heredó escalera/molestia (nivel %, molestia %)', v.escalamiento_nivel, v.molestia_nivel;
  end if;
  if v.sin_respuesta_desde is null or v.entradas_sin_respuesta <> 1 then
    raise exception '0648: el ciclo nuevo no arrancó su reloj ni su insistencia';
  end if;
  if r.duplicado then raise exception '0648: un wamid nuevo salió como duplicado'; end if;

  -- Un wamid repetido sobre un hilo sin ciclo NO lo toca (el camino de duplicado no cambia).
  update public.vigia_conversacion set sin_respuesta_desde = null, escalamiento_nivel = 2 where id = v.id;
  perform * from public.vigia_recibir_mensaje(t, c, 'wamid.0648.3', 'texto', 'de nuevo', now());
  select * into v from public.vigia_conversacion where id = v.id;
  if v.sin_respuesta_desde is not null or v.escalamiento_nivel <> 2 then
    raise exception '0648: un duplicado movió el hilo';
  end if;
end $$;

rollback;
