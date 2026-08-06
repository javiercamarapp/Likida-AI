-- ═══════════════════════════════════════════════════════════════════════════
-- 0083 — config_tenant_valida exige la FORMA de la facilidad del 15%
--
-- La 0082 admitió la llave, pero un contenido cualquiera ("sí") pasaba el
-- validador y el motor lo leía como "no elegible" en silencio. Copia íntegra
-- de la función de la 0082 con el chequeo de forma añadido.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function config_tenant_valida(p_config jsonb)
returns boolean
language plpgsql
immutable
as $fn$
declare
  -- Las 9 llaves de `CuadraConfig` (config.ts:22-52). Si aquí falta una que el
  -- tipo sí tiene, la config legítima se rechaza; si sobra una, el typo pasa.
  llaves_ok  text[] := array['empresa','politica','tabulador','unidades',
                             'catalogoCuentas','salida','hidrocarburos',
                             'estimulos','validacion','facilidadCombustibleEfectivo'];
  -- Los 9 de `ConceptoGasto`. Tienen que ser LOS MISMOS que el CHECK de 0025:
  -- una política sobre un concepto que `gasto.concepto` no puede tener es un
  -- tope que nunca empata con nada (`politicaPara`, engine.ts:54-59).
  conceptos  text[] := array['diesel','caseta','factura','alimentacion',
                             'hospedaje','transporte','flete','viaticos','otro'];
  k    text;
  e    jsonb;
  o    jsonb;
  r    record;
  v    numeric;
begin
  if p_config is null then
    return true;   -- sin override: corre DEMO_CONFIG. Es el estado de hoy.
  end if;

  if jsonb_typeof(p_config) <> 'object' then
    raise exception
      'tenant.config tiene que ser un objeto JSON y llegó un %. El motor hace `fusionarConfig(DEMO_CONFIG, config)` y con cualquier otra cosa la config entera se reemplaza por eso.',
      jsonb_typeof(p_config);
  end if;

  -- ── Regla 2: nada de llaves inventadas ────────────────────────────────────
  for k in select jsonb_object_keys(p_config) loop
    if not (k = any(llaves_ok)) then
      raise exception
        'tenant.config trae la llave "%", que CuadraConfig no conoce. Las válidas son: %. Una llave mal escrita no da error: se guarda, no la lee nadie, y la flota corre con los topes de DEMO_CONFIG creyendo que corre con los suyos.',
        k, array_to_string(llaves_ok, ', ');
    end if;
  end loop;

  -- ── facilidadCombustibleEfectivo: la FORMA (0083), no solo la llave ─────
  -- Un contenido cualquiera ("sí", un número) pasaba la 0082 y el motor lo
  -- leía como "no elegible" en silencio — el typo silencioso que la 0026
  -- existe para impedir. La llave, cuando existe, exige las DOS condiciones
  -- como booleanos (o `null` = sin declarar).
  if jsonb_exists(p_config, 'facilidadCombustibleEfectivo') then
    o := p_config -> 'facilidadCombustibleEfectivo';
    if o is null or o = 'null'::jsonb then
      null;  -- sin declaración: válido (el motor trata como "sin declarar")
    elsif jsonb_typeof(o) <> 'object' then
      raise exception 'facilidadCombustibleEfectivo tiene que ser un objeto con dedicacionExclusivaCarga y regimenElegible (booleanos), y llegó %. Un "sí" o un número se leen como "no elegible" en silencio.', jsonb_typeof(o);
    else
      e := o -> 'dedicacionExclusivaCarga';
      r := o -> 'regimenElegible';
      if e is null or e = 'null'::jsonb or r is null or r = 'null'::jsonb then
        raise exception 'facilidadCombustibleEfectivo necesita LAS DOS condiciones (dedicacionExclusivaCarga y regimenElegible); con una sola falta, el motor la lee como "no elegible" en silencio.';
      end if;
      if jsonb_typeof(e) <> 'boolean' or jsonb_typeof(r) <> 'boolean' then
        raise exception 'dedicacionExclusivaCarga y regimenElegible tienen que ser booleanos (true/false), no %. Un "sí" o un texto se leen como "no elegible".', jsonb_typeof(e);
      end if;
    end if;
  end if;

  -- ── politica: el tope de la flota ─────────────────────────────────────────
  if jsonb_exists(p_config, 'politica') then
    o := p_config -> 'politica';

    if jsonb_typeof(o) <> 'array' then
      raise exception
        'tenant.config->politica tiene que ser un array y es un %. El motor hace `pol.filter(...)` (engine.ts:57) y con cualquier otra cosa revienta el cuadre entero con "pol.filter is not a function" — el operador escribe "listo" y no recibe nada.',
        jsonb_typeof(o);
    end if;

    -- Regla 3.
    if jsonb_array_length(o) = 0 then
      raise exception
        'tenant.config->politica es un array VACÍO, y eso quita el tope de TODOS los conceptos sin dejar rastro: la liquidación sale sin una sola diferencia `sobre_politica` y parece que la flota cumple. Si de verdad no hay topes, dilo concepto por concepto — [{"concepto":"diesel"},{"concepto":"alimentacion"}] es una política sin topes, explícita. Si lo que quieres son los topes de demo, quita la llave `politica` por completo.';
    end if;

    for e in select * from jsonb_array_elements(o) loop
      if jsonb_typeof(e) <> 'object' then
        raise exception 'tenant.config->politica trae un elemento que es un % y tiene que ser un objeto {"concepto": …}.', jsonb_typeof(e);
      end if;
      if jsonb_typeof(e -> 'concepto') is distinct from 'string' then
        raise exception
          'tenant.config->politica trae un elemento sin `concepto` de texto (%). El motor hace `p.concepto.toLowerCase()` (engine.ts:57) y ahí truena el cuadre.', e::text;
      end if;
      if not ((e ->> 'concepto') = any(conceptos)) then
        raise exception
          'tenant.config->politica pone un tope al concepto "%", que no existe en ConceptoGasto. Ese tope no empata con ningún gasto —`politicaPara` no lo encuentra— así que el concepto queda SIN tope y nadie se entera. Válidos: %.',
          e ->> 'concepto', array_to_string(conceptos, ', ');
      end if;
      if jsonb_exists(e, 'topeMonto') and jsonb_typeof(e -> 'topeMonto') <> 'number' then
        raise exception
          'tenant.config->politica: el `topeMonto` de "%" es un % y tiene que ser un número. El motor compara `g.monto > pol.topeMonto` (engine.ts:247); contra un texto o un null esa comparación es siempre falsa y el tope no aplica NUNCA.',
          e ->> 'concepto', jsonb_typeof(e -> 'topeMonto');
      end if;
      if jsonb_exists(e, 'topeMonto') and (e ->> 'topeMonto')::numeric <= 0 then
        raise exception 'tenant.config->politica: el `topeMonto` de "%" es % y tiene que ser mayor que cero.', e ->> 'concepto', e ->> 'topeMonto';
      end if;
      if jsonb_exists(e, 'requiereCfdi') and jsonb_typeof(e -> 'requiereCfdi') <> 'boolean' then
        raise exception 'tenant.config->politica: el `requiereCfdi` de "%" tiene que ser true o false.', e ->> 'concepto';
      end if;
      if jsonb_exists(e, 'ruta') and jsonb_typeof(e -> 'ruta') <> 'string' then
        raise exception 'tenant.config->politica: la `ruta` de "%" tiene que ser texto.', e ->> 'concepto';
      end if;
    end loop;
  end if;

  -- ── estimulos: los topes que vienen de la ley, no de la flota ─────────────
  if jsonb_exists(p_config, 'estimulos') then
    o := p_config -> 'estimulos';
    if jsonb_typeof(o) <> 'object' then
      raise exception 'tenant.config->estimulos tiene que ser un objeto y es un %.', jsonb_typeof(o);
    end if;

    for r in
      select * from (values
        ('viaticosTopeFiscalDiarioMxn', 0.01::numeric, 1000000::numeric,
         'el tope de alimentación de $750/día (LISR 28-V). En null, la porción excedente del viático deja de marcarse como no deducible y la liquidación afirma que todo se deduce'),
        ('efectivoTopeMxn',             0.01::numeric, 10000000::numeric,
         'el tope de $2,000 para gasto no-combustible en efectivo (LISR 27-III). En null, deja de dispararse `efectivo_sobre_tope`'),
        ('peajeFactor',                 0::numeric,    1::numeric,
         'el factor del estímulo de peaje (LIF 2026 art. 20-A). Fuera de 0..1 acredita un porcentaje que la ley no da')
      ) as t(llave, minimo, maximo, para)
    loop
      if jsonb_exists(o, r.llave) then
        if jsonb_typeof(o -> r.llave) <> 'number' then
          raise exception
            'tenant.config->estimulos->% es % y tiene que ser un número. Es %. Si lo que quieres es el valor por defecto, QUITA la llave: `fusionarConfig` reemplaza null, no lo ignora (config.ts:135).',
            r.llave, jsonb_typeof(o -> r.llave), r.para;
        end if;
        v := (o ->> r.llave)::numeric;
        if v < r.minimo or v > r.maximo then
          raise exception 'tenant.config->estimulos->% vale % y tiene que estar entre % y %. Es %.',
            r.llave, v, r.minimo, r.maximo, r.para;
        end if;
      end if;
    end loop;

    for r in select * from (values ('clavesDieselIeps'), ('clavesPeaje')) as t(llave) loop
      if jsonb_exists(o, r.llave) then
        if jsonb_typeof(o -> r.llave) <> 'array' then
          raise exception 'tenant.config->estimulos->% tiene que ser un array de claves c_ClaveProdServ (texto).', r.llave;
        end if;
        for e in select * from jsonb_array_elements(o -> r.llave) loop
          if jsonb_typeof(e) <> 'string' then
            raise exception 'tenant.config->estimulos->% trae un elemento que no es texto (%). Las claves del SAT son cadenas de 8 dígitos, no números: como número, "15101505" y 15101505 no comparan igual.', r.llave, e::text;
          end if;
        end loop;
      end if;
    end loop;
  end if;

  -- ── tabulador: rendimiento y precio del diésel ────────────────────────────
  if jsonb_exists(p_config, 'tabulador') then
    o := p_config -> 'tabulador';
    if jsonb_typeof(o) <> 'object' then
      raise exception 'tenant.config->tabulador tiene que ser un objeto y es un %.', jsonb_typeof(o);
    end if;
    for r in
      select * from (values
        ('rendimientoPorDefecto',  0.01::numeric, 100::numeric),
        ('factorCarga',            0.01::numeric, 2::numeric),
        ('precioDieselPorDefecto', 0.01::numeric, 1000::numeric),
        ('umbralDesviacion',       0::numeric,    1::numeric)
      ) as t(llave, minimo, maximo)
    loop
      if jsonb_exists(o, r.llave) then
        if jsonb_typeof(o -> r.llave) <> 'number' then
          raise exception 'tenant.config->tabulador->% tiene que ser un número (llegó %). Un cero o un null aquí produce una desviación de diésel infinita o ninguna.', r.llave, jsonb_typeof(o -> r.llave);
        end if;
        v := (o ->> r.llave)::numeric;
        if v < r.minimo or v > r.maximo then
          raise exception 'tenant.config->tabulador->% vale % y tiene que estar entre % y %.', r.llave, v, r.minimo, r.maximo;
        end if;
      end if;
    end loop;
  end if;

  -- ── empresa: el RFC contra el que se valida el receptor de cada CFDI ──────
  if jsonb_exists(p_config, 'empresa') then
    o := p_config -> 'empresa';
    if jsonb_typeof(o) <> 'object' then
      raise exception 'tenant.config->empresa tiene que ser un objeto {"rfc": "…"}.';
    end if;
    if jsonb_exists(o, 'rfc') and jsonb_typeof(o -> 'rfc') <> 'string' then
      raise exception 'tenant.config->empresa->rfc tiene que ser texto. Sin un RFC legible, la validación de receptor de CFDI queda apagada y ninguna factura se rechaza por estar a nombre de otro (config.ts:158-166).';
    end if;
    if jsonb_exists(o, 'rfcsAdicionales') then
      if jsonb_typeof(o -> 'rfcsAdicionales') <> 'array' then
        raise exception 'tenant.config->empresa->rfcsAdicionales tiene que ser un array de RFC en texto.';
      end if;
      for e in select * from jsonb_array_elements(o -> 'rfcsAdicionales') loop
        if jsonb_typeof(e) <> 'string' then
          raise exception 'tenant.config->empresa->rfcsAdicionales trae un elemento que no es texto (%).', e::text;
        end if;
      end loop;
    end if;
  end if;

  -- ── salida: el formato del export al ERP ──────────────────────────────────
  if jsonb_exists(p_config, 'salida') then
    if (p_config ->> 'salida') is null
       or not ((p_config ->> 'salida') in ('csv','contpaqi_txt','aspel_xls')) then
      raise exception
        'tenant.config->salida vale % y solo puede ser csv, contpaqi_txt o aspel_xls. Cualquier otra cosa deja al contralor sin archivo que subir a su contabilidad.',
        coalesce(p_config ->> 'salida', 'null');
    end if;
  end if;

  -- ── hidrocarburos: qué claves del SAT son combustible ─────────────────────
  if jsonb_exists(p_config, 'hidrocarburos') then
    o := p_config -> 'hidrocarburos';
    if jsonb_typeof(o) <> 'object' then
      raise exception 'tenant.config->hidrocarburos tiene que ser un objeto.';
    end if;
    if jsonb_exists(o, 'claves') then
      if jsonb_typeof(o -> 'claves') <> 'array' or jsonb_array_length(o -> 'claves') = 0 then
        raise exception
          'tenant.config->hidrocarburos->claves tiene que ser un array NO vacío. Vacío, ningún CFDI se reconoce como combustible: se apaga la exigencia del complemento de hidrocarburos (RMF 2.7.1.8) y el estímulo de IEPS a la vez.';
      end if;
      for e in select * from jsonb_array_elements(o -> 'claves') loop
        if jsonb_typeof(e) <> 'string' then
          raise exception 'tenant.config->hidrocarburos->claves trae un elemento que no es texto (%).', e::text;
        end if;
      end loop;
    end if;
    if jsonb_exists(o, 'unidad') and jsonb_typeof(o -> 'unidad') <> 'string' then
      raise exception 'tenant.config->hidrocarburos->unidad tiene que ser texto (p.ej. "LTR").';
    end if;
    if jsonb_exists(o, 'vigenteDesde') then
      if jsonb_typeof(o -> 'vigenteDesde') <> 'string' then
        raise exception 'tenant.config->hidrocarburos->vigenteDesde tiene que ser una fecha ISO en texto ("2026-04-24").';
      end if;
      -- Se comprueba la FORMA con una regex y no con un cast a `date`: el cast
      -- depende de `DateStyle`, o sea del entorno, y esta función tiene que ser
      -- inmutable de verdad. `new Date("2026-04-24")` es lo que la lee.
      if (o ->> 'vigenteDesde') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'tenant.config->hidrocarburos->vigenteDesde ("%") no tiene forma de fecha ISO (AAAA-MM-DD). Es el día desde el que se exige el complemento de hidrocarburos; una fecha ilegible lo exige siempre o nunca.', o ->> 'vigenteDesde';
      end if;
    end if;
  end if;

  -- ── validacion: la tolerancia de fecha del gasto ──────────────────────────
  if jsonb_exists(p_config, 'validacion') then
    o := p_config -> 'validacion';
    if jsonb_typeof(o) <> 'object' then
      raise exception 'tenant.config->validacion tiene que ser un objeto.';
    end if;
    if jsonb_exists(o, 'fechaToleranciaDiasAntes') then
      if jsonb_typeof(o -> 'fechaToleranciaDiasAntes') <> 'number' then
        raise exception 'tenant.config->validacion->fechaToleranciaDiasAntes tiene que ser un número de días.';
      end if;
      v := (o ->> 'fechaToleranciaDiasAntes')::numeric;
      if v < 0 or v > 3650 then
        raise exception 'tenant.config->validacion->fechaToleranciaDiasAntes vale % y tiene que estar entre 0 y 3650 días.', v;
      end if;
    end if;
  end if;

  -- ── unidades y catalogoCuentas: mapas planos ──────────────────────────────
  if jsonb_exists(p_config, 'unidades') and jsonb_typeof(p_config -> 'unidades') <> 'object' then
    raise exception 'tenant.config->unidades tiene que ser un objeto placa → {rendimientoBase, capacidadTanque}.';
  end if;
  if jsonb_exists(p_config, 'catalogoCuentas') then
    if jsonb_typeof(p_config -> 'catalogoCuentas') <> 'object' then
      raise exception 'tenant.config->catalogoCuentas tiene que ser un objeto concepto → cuenta contable.';
    end if;
    for k in select jsonb_object_keys(p_config -> 'catalogoCuentas') loop
      if jsonb_typeof((p_config -> 'catalogoCuentas') -> k) <> 'string' then
        raise exception 'tenant.config->catalogoCuentas->% tiene que ser texto: es el número de cuenta que va al archivo del ERP.', k;
      end if;
    end loop;
  end if;

  return true;
end $fn$;

comment on function config_tenant_valida(jsonb) is
  'Valida tenant.config contra CuadraConfig (0026; 0082 añadió la facilidad del 15%; 0083 exige su FORMA).';
