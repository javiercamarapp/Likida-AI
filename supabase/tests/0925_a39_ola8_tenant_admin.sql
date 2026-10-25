\set ON_ERROR_STOP on
-- 0925 — A39-S57-01: tenant.rfc_sat_verificado existe, nace NULL y solo admite forma de RFC.
begin;

insert into public.tenant (id, nombre, rfc) values ('92500000-0000-4000-8000-0000000000a1', 'Flota 0925', 'AAA010101AB1');

do $$
declare v text;
begin
  select rfc_sat_verificado into v from public.tenant where id = '92500000-0000-4000-8000-0000000000a1';
  if v is not null then raise exception '0925: rfc_sat_verificado no nace NULL (copió tenant.rfc): %', v; end if;

  update public.tenant set rfc_sat_verificado = 'AAA010101AB1' where id = '92500000-0000-4000-8000-0000000000a1';
  select rfc_sat_verificado into v from public.tenant where id = '92500000-0000-4000-8000-0000000000a1';
  if v <> 'AAA010101AB1' then raise exception '0925: no guardó el RFC verificado'; end if;

  begin
    update public.tenant set rfc_sat_verificado = 'abc' where id = '92500000-0000-4000-8000-0000000000a1';
    raise exception '0925: aceptó un RFC sin forma';
  exception when check_violation then null;
  end;
end $$;

rollback;
