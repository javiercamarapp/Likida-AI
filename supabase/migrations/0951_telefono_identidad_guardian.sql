-- REVERSA: `drop trigger if exists telefono_identidad_guarda on public.operador; drop trigger if exists telefono_identidad_guarda on public.app_user; drop trigger if exists telefono_identidad_guarda on public.vigia_contacto; drop function if exists public.telefono_identidad_guarda();` Sin esos disparadores la base vuelve a aceptar el mismo número en dos tablas o dos flotas (los índices de 0024, 0059 y 0400 siguen vigentes). No hay filas que reponer.
-- ═══════════════════════════════════════════════════════════════════════════
-- 0951 — F1 lote B, L1H (CT-SEG-07 / X-01): guardián de unicidad del teléfono, SOLO PARA FILAS NUEVAS O CAMBIADAS.
--
-- Por qué un DISPARADOR y no un índice único: (a) un índice único entre tres tablas no existe; (b) un índice único
-- sobre `telefono_canonico` en `app_user`/`vigia_contacto` FALLARÍA al crearse si hoy hay duplicados (no se sabe), y
-- «NOT VALID» no existe para índices. El disparador solo mira la fila que se inserta o cuyo teléfono / estado activo /
-- flota cambia: los duplicados que ya existen NO se tocan ni bloquean otras ediciones de esas filas (se listan con
-- `telefono_identidad_conflictos()` y con scripts/f1-consulta-duplicados-telefono.sql para que Javier decida).
--
-- Regla (sobre filas ACTIVAS; teléfono canónico de la 0950):
--   · dos filas de la MISMA tabla con el mismo teléfono: prohibido (en cualquier flota);
--   · filas de tablas DISTINTAS con el mismo teléfono: prohibido si son de flotas DISTINTAS. En la misma flota se
--     permite (un dueño que también maneja); el resolutor (0952) lo reporta como `misma_flota`, nunca adivina otra flota.
--
-- SECURITY DEFINER con search_path fijo: el disparador tiene que VER las filas de todas las flotas aunque quien escribe
-- tenga RLS (si viera solo su flota, el chequeo entre flotas no serviría). Serializa por teléfono con un candado
-- consultivo de transacción para que dos altas simultáneas del mismo número en flotas distintas no pasen las dos.
-- El mensaje NO dice de qué flota ni de quién es el número (no es un oráculo); imita el de un índice único
-- («duplicate key value violates unique constraint "telefono_identidad_unica"», SQLSTATE 23505) para que `chocaContra`,
-- `violaIndice` y los demás reconocedores de choque de teléfono del código lo traten igual que a los índices de 0024/0059.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.telefono_identidad_guarda()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_canon text;
  v_activo boolean;
  v_sin_cambio boolean := false;
  v_hay boolean;
begin
  if tg_table_name = 'operador' then
    v_activo := coalesce(new.activo, false) and new.telefono !~ '^sin-tel:';
    v_canon := public.telefono_canonico(new.telefono);
    if tg_op = 'UPDATE' then
      v_sin_cambio := old.telefono is not distinct from new.telefono
                  and old.activo is not distinct from new.activo
                  and old.tenant_id is not distinct from new.tenant_id;
    end if;
  elsif tg_table_name = 'app_user' then
    v_activo := new.telefono is not null and coalesce(new.activo, true);
    v_canon := public.telefono_canonico(new.telefono);
    if tg_op = 'UPDATE' then
      v_sin_cambio := old.telefono is not distinct from new.telefono
                  and old.activo is not distinct from new.activo
                  and old.tenant_id is not distinct from new.tenant_id;
    end if;
  elsif tg_table_name = 'vigia_contacto' then
    v_activo := new.estado = 'activo';
    v_canon := public.telefono_canonico(new.telefono);
    if tg_op = 'UPDATE' then
      v_sin_cambio := old.telefono is not distinct from new.telefono
                  and old.estado is not distinct from new.estado
                  and old.tenant_id is not distinct from new.tenant_id;
    end if;
  else
    return new;
  end if;

  -- Solo filas nuevas o cuyo teléfono / activo / flota cambió: los duplicados históricos no se tocan.
  -- Y solo números marcables (10-15 dígitos): el teléfono seudonimizado por ARCO («anon:…») jamás debe frenar una cancelación.
  if v_sin_cambio or not v_activo or v_canon is null or v_canon !~ '^[0-9]{10,15}$' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('telefono_identidad:' || v_canon, 0));

  select exists (
    select 1
      from public.telefono_identidades(v_canon) i
     where not (i.tabla = tg_table_name and i.ref_id = new.id)
       and (i.tenant_id is distinct from new.tenant_id or i.tabla = tg_table_name)
  ) into v_hay;

  if v_hay then
    raise exception using
      errcode = '23505',
      constraint = 'telefono_identidad_unica',
      message = 'duplicate key value violates unique constraint "telefono_identidad_unica": ese teléfono ya identifica a otra cuenta o contacto en Likida y no puede usarse aquí',
      hint = 'Corrige el duplicado (scripts/f1-consulta-duplicados-telefono.sql) o usa otro número.';
  end if;

  return new;
end;
$$;

comment on function public.telefono_identidad_guarda() is
  '0951: guardián de unicidad del teléfono de WhatsApp (operador, app_user, vigia_contacto). Solo filas nuevas o cuyo teléfono/activo/flota cambia; no toca duplicados históricos.';

revoke all on function public.telefono_identidad_guarda() from public, anon, authenticated;

drop trigger if exists telefono_identidad_guarda on public.operador;
create trigger telefono_identidad_guarda
  before insert or update of telefono, activo, tenant_id on public.operador
  for each row execute function public.telefono_identidad_guarda();

drop trigger if exists telefono_identidad_guarda on public.app_user;
create trigger telefono_identidad_guarda
  before insert or update of telefono, activo, tenant_id on public.app_user
  for each row execute function public.telefono_identidad_guarda();

drop trigger if exists telefono_identidad_guarda on public.vigia_contacto;
create trigger telefono_identidad_guarda
  before insert or update of telefono, estado, tenant_id on public.vigia_contacto
  for each row execute function public.telefono_identidad_guarda();
