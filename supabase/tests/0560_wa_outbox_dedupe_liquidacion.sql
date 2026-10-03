\set ON_ERROR_STOP on
-- 0560: encolar_wa_outbox_dedupe acepta la entrega de liquidaciones externas.
-- Los dos payloads de abajo son EXACTAMENTE los que arma el código
-- (entrega.ts: payloadSesion y el selector durable con la plantilla del
-- catálogo); si el código cambia de forma, esta prueba lo dice.
begin;

create temp table _p (sesion jsonb, plantilla jsonb) on commit drop;
insert into _p values ('{"messaging_product": "whatsapp", "to": "525512345678", "type": "interactive", "interactive": {"type": "button", "header": {"type": "document", "document": {"link": "https://storage.example/f.pdf?t=1", "filename": "liq-1.pdf"}}, "body": {"text": "Hola Juan, esta es tu liquidación (SAP).\nPeriodo: 01 sep 2026 al 07 sep 2026\nTotal: $2,499.75 MXN\nEl detalle va en el PDF. ¿Te cuadra? Respóndeme con un botón."}, "action": {"buttons": [{"type": "reply", "reply": {"id": "liqext_ok:3f2504e0-4f89-41d3-9a0c-0305e82c3301", "title": "Recibida"}}, {"type": "reply", "reply": {"id": "liqext_no:3f2504e0-4f89-41d3-9a0c-0305e82c3301", "title": "No coincide"}}]}}}'::jsonb, '{"messaging_product": "whatsapp", "to": "525512345678", "type": "template", "template": {"name": "liquidacion_externa_v1", "language": {"code": "es_MX"}, "components": [{"type": "header", "parameters": [{"type": "document", "document": {"link": "https://storage.example/f.pdf?t=1", "filename": "liq-1.pdf"}}]}, {"type": "body", "parameters": [{"type": "text", "text": "Juan"}, {"type": "text", "text": "SAP"}, {"type": "text", "text": "01 sep 2026 al 07 sep 2026"}, {"type": "text", "text": "$2,499.75 MXN"}]}, {"type": "button", "sub_type": "quick_reply", "index": "0", "parameters": [{"type": "payload", "payload": "liqext_ok:3f2504e0-4f89-41d3-9a0c-0305e82c3301"}]}, {"type": "button", "sub_type": "quick_reply", "index": "1", "parameters": [{"type": "payload", "payload": "liqext_no:3f2504e0-4f89-41d3-9a0c-0305e82c3301"}]}]}}'::jsonb);

do $$
declare
  v_id_txt text;
  v_ses jsonb; v_pla jsonb; r record; v_falla boolean;
  k_s constant text := 'liqext:3f2504e0-4f89-41d3-9a0c-0305e82c3301:g1:sesion';
  k_p constant text := 'liqext:3f2504e0-4f89-41d3-9a0c-0305e82c3301:g1:plantilla';
begin
  select sesion, plantilla into v_ses, v_pla from _p;

  -- (a) los dos payloads reales entran y son idempotentes por llave.
  select * into r from public.encolar_wa_outbox_dedupe(k_s, v_ses, 'liquidación externa');
  if r.estado <> 'pending' then raise exception 'FALLO a1: la sesión no quedó pending (%)', r.estado; end if;
  declare v_id uuid := r.id; begin
    select * into r from public.encolar_wa_outbox_dedupe(k_s, v_ses, 'otra vez');
    if r.id <> v_id then raise exception 'FALLO a2: encolar dos veces duplicó la fila'; end if;
  end;
  perform public.encolar_wa_outbox_dedupe(k_p, v_pla, 'por plantilla');
  if (select count(*) from public.wa_outbox where dedupe_key in (k_s, k_p)) <> 2 then
    raise exception 'FALLO a3: tenían que quedar exactamente dos filas';
  end if;

  -- (b) la llave tiene que cuadrar con el tipo del payload.
  v_falla := false;
  begin perform public.encolar_wa_outbox_dedupe(k_s, v_pla, 'x'); exception when others then v_falla := true; end;
  if not v_falla then raise exception 'FALLO b1: una llave :sesion aceptó un payload de plantilla'; end if;
  v_falla := false;
  begin perform public.encolar_wa_outbox_dedupe('liqext:3f2504e0-4f89-41d3-9a0c-0305e82c3301:g2:plantilla', v_ses, 'x'); exception when others then v_falla := true; end;
  if not v_falla then raise exception 'FALLO b2: una llave :plantilla aceptó un payload de sesión'; end if;

  -- (c) llaves mal formadas o prefijos sin validador.
  foreach v_id_txt in array array['liqext:abc:g1:sesion','liqext:3f2504e0-4f89-41d3-9a0c-0305e82c3301:g1:otra','liqext:3f2504e0-4f89-41d3-9a0c-0305e82c3301:sesion','cond:3f2504e0-4f89-41d3-9a0c-0305e82c3301','otro:x'] loop
    v_falla := false;
    begin perform public.encolar_wa_outbox_dedupe(v_id_txt, v_ses, 'x'); exception when others then v_falla := true; end;
    if not v_falla then raise exception 'FALLO c: la llave % se aceptó', v_id_txt; end if;
  end loop;

  -- (d) payloads rotos de sesión (cada uno por separado).
  declare v_malo jsonb; v_i int := 0; begin
    foreach v_malo in array array[
      v_ses #- '{interactive,header}',                                           -- sin documento
      jsonb_set(v_ses, '{interactive,header,document,link}', '"http://x.example/a.pdf"'),   -- no https
      jsonb_set(v_ses, '{interactive,header,document,filename}', '" "'),         -- sin nombre
      jsonb_set(v_ses, '{interactive,body,text}', to_jsonb(repeat('x', 1025))),   -- cuerpo largo
      v_ses #- '{interactive,action,buttons,1}',                                  -- un solo botón
      jsonb_set(v_ses, '{interactive,action,buttons,0,reply,title}', to_jsonb(repeat('x', 21))), -- título largo
      jsonb_set(v_ses, '{interactive,action,buttons,0,reply,id}', '"otro:123"'),  -- id ajeno
      jsonb_set(v_ses, '{to}', '"abc"'),                                          -- destinatario inválido
      jsonb_set(v_ses, '{messaging_product}', '"sms"')
    ] loop
      v_i := v_i + 1; v_falla := false;
      begin perform public.encolar_wa_outbox_dedupe('liqext:3f2504e0-4f89-41d3-9a0c-0305e82c3301:g'||(10+v_i)||':sesion', v_malo, 'x'); exception when others then v_falla := true; end;
      if not v_falla then raise exception 'FALLO d%: un payload de sesión roto se aceptó', v_i; end if;
    end loop;
  end;

  -- (e) payloads rotos de plantilla.
  declare v_malo jsonb; v_i int := 0; begin
    foreach v_malo in array array[
      jsonb_set(v_pla, '{template,name}', '"otra_plantilla"'),
      jsonb_set(v_pla, '{template,language,code}', '"en_US"'),
      v_pla #- '{template,components,0}',                                          -- sin encabezado
      jsonb_set(v_pla, '{template,components,0,parameters,0,document,link}', '"http://x.example/a.pdf"'),
      v_pla #- '{template,components,1,parameters,3}',                              -- 3 variables
      jsonb_set(v_pla, '{template,components,1,parameters,0,text}', '" "'),         -- variable vacía
      jsonb_set(v_pla, '{template,components,2,parameters,0,payload}', '"x:1"')   -- payload ajeno
    ] loop
      v_i := v_i + 1; v_falla := false;
      begin perform public.encolar_wa_outbox_dedupe('liqext:3f2504e0-4f89-41d3-9a0c-0305e82c3301:g'||(30+v_i)||':plantilla', v_malo, 'x'); exception when others then v_falla := true; end;
      if not v_falla then raise exception 'FALLO e%: un payload de plantilla roto se aceptó', v_i; end if;
    end loop;
  end;

  -- (f) GPS sigue funcionando igual que con la 0333 (no se rompió la rama vieja).
  perform public.encolar_wa_outbox_dedupe('gps:0560:ok',
    jsonb_build_object('messaging_product','whatsapp','to','529999999999','type','template',
      'template',jsonb_build_object('name','gps_alerta_critica','language',jsonb_build_object('code','es_MX'),
        'components',jsonb_build_array(
          jsonb_build_object('type','body','parameters',jsonb_build_array(jsonb_build_object('type','text','text','alerta'))),
          jsonb_build_object('type','button','sub_type','quick_reply','index','0','parameters',jsonb_build_array(jsonb_build_object('type','payload','payload','ok')))))));
  v_falla := false;
  begin
    perform public.encolar_wa_outbox_dedupe('gps:0560:malo', v_ses, 'x');   -- un payload no-GPS con llave gps:
  exception when others then v_falla := true; end;
  if not v_falla then raise exception 'FALLO f: una llave gps: aceptó un payload que no es la alerta GPS'; end if;

  -- (g) solo service_role la ejecuta.
  if has_function_privilege('anon', 'public.encolar_wa_outbox_dedupe(text,jsonb,text)', 'execute')
     or has_function_privilege('authenticated', 'public.encolar_wa_outbox_dedupe(text,jsonb,text)', 'execute') then
    raise exception 'FALLO g: anon/authenticated pueden ejecutar encolar_wa_outbox_dedupe';
  end if;
  if not has_function_privilege('service_role', 'public.encolar_wa_outbox_dedupe(text,jsonb,text)', 'execute') then
    raise exception 'FALLO g2: service_role no puede ejecutar encolar_wa_outbox_dedupe';
  end if;
end $$;

rollback;
