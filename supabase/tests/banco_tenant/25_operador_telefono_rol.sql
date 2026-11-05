-- ═══════════════════════════════════════════════════════════════════════════
-- [BANCO:OPERADOR] (b') Prueba DINAMICA del chofer (`operador`): su identidad en la base es el telefono de WhatsApp y su "rol"
-- ya no existe como cuenta con login (0086), asi que lo que lo protege es la FORMA del telefono. Corre despues de la siembra
-- (20_siembra_lectura.sql) dentro de la misma transaccion y comprueba con Postgres real:
--   · `operador_telefono_forma` existe y RECHAZA (23514) un telefono sin forma en una fila no anonimizada;
--   · la misma constraint ACEPTA el telefono con 10-15 digitos, el marcador «sin-tel:<20 letras>» (0932) y la fila anonimizada;
--   · el dominio de `app_user.rol` sigue SIN admitir 'operador' (no hay login de chofer: su unica interfaz es WhatsApp).
-- Un incumplimiento es un hallazgo `operador_forma` (critico): la barrera de identidad entre flotas dejo de cerrar.
-- Las filas de prueba viven en la transaccion del banco y se deshacen con el rollback del epilogo.
-- ═══════════════════════════════════════════════════════════════════════════
do $banco$
declare
  v_ta uuid := 'ba000000-0000-4000-8000-0000000000a1';
  e text;
  n_pruebas int := 0;
  v_ok boolean;
begin
  set local session_replication_role = replica;   -- sin disparadores ni FKs: aqui se prueba la constraint, no las reglas de negocio

  -- 0) La constraint existe en el catalogo (si alguien la borra, la forma del telefono deja de protegerse).
  n_pruebas := n_pruebas + 1;
  if not exists (select 1 from pg_constraint where conname = 'operador_telefono_forma' and conrelid = 'public.operador'::regclass and contype = 'c') then
    perform ci_banco.hallazgo('operador_forma', 'public.operador.operador_telefono_forma', 'critica', 'la constraint operador_telefono_forma no existe');
  end if;

  -- 1) Rechaza un telefono sin forma en una fila NO anonimizada.
  n_pruebas := n_pruebas + 1;
  e := ci_banco.sembrar('public.operador'::regclass, v_ta, '{"telefono":"no-es-telefono","anonimizado_en":"@N"}'::jsonb, 1);
  if e is null or left(e, 5) <> '23514' or e not like '%operador_telefono_forma%' then
    perform ci_banco.hallazgo('operador_forma', 'public.operador.telefono_sin_forma', 'critica',
      format('un telefono sin forma NO fue rechazado por operador_telefono_forma (resultado: %s)', coalesce(left(e, 160), 'insertado')));
  end if;

  -- 2) Acepta telefono con forma, el marcador sin WhatsApp y la fila anonimizada (el derecho de cancelacion ARCO).
  n_pruebas := n_pruebas + 1;
  e := ci_banco.sembrar('public.operador'::regclass, v_ta, '{"telefono":"529991110001"}'::jsonb, 1);
  if e is not null then
    perform ci_banco.hallazgo('operador_forma', 'public.operador.telefono_con_forma', 'critica', format('un telefono de 12 digitos fue rechazado: %s', left(e, 160)));
  end if;
  n_pruebas := n_pruebas + 1;
  e := ci_banco.sembrar('public.operador'::regclass, v_ta, '{"telefono":"sin-tel:abcdefghijklmnopqrst"}'::jsonb, 1);
  if e is not null then
    perform ci_banco.hallazgo('operador_forma', 'public.operador.marcador_sin_tel', 'critica', format('el marcador sin-tel:<20 letras> fue rechazado: %s', left(e, 160)));
  end if;
  n_pruebas := n_pruebas + 1;
  e := ci_banco.sembrar('public.operador'::regclass, v_ta,
    '{"telefono":"anon:0123456789abcdef","anonimizado_en":"=now()","activo":"false"}'::jsonb, 1);
  if e is not null then
    perform ci_banco.hallazgo('operador_forma', 'public.operador.anonimizado', 'critica', format('la fila anonimizada fue rechazada: %s', left(e, 160)));
  end if;

  -- 3) El chofer no tiene cuenta: 'operador' no esta en el dominio de app_user.rol.
  n_pruebas := n_pruebas + 1;
  e := ci_banco.sembrar('public.app_user'::regclass, v_ta,
    '{"id":"ba000000-0000-4000-8000-0000000000c3","email":"banco-chofer@ejemplo.test","rol":"operador"}'::jsonb, 1);
  v_ok := e is not null and left(e, 5) = '23514' and e like '%app_user_rol_dominio%';
  if not v_ok then
    perform ci_banco.hallazgo('operador_forma', 'public.app_user.rol_operador', 'critica',
      format('app_user.rol admite (o fallo por otra causa) el rol operador retirado en 0086 (resultado: %s)', coalesce(left(e, 160), 'insertado')));
  end if;

  set local session_replication_role = origin;
  insert into ci_banco.cobertura values ('prueba:operador_forma', 'sembrada', n_pruebas::text || ' comprobaciones');
end
$banco$;
