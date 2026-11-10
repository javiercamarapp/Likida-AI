'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Save } from 'lucide-react';
import { AvisoResultado, Boton, CampoFecha, CampoSelect, CampoTexto, Fieldset, Icono } from '@/app/ui-v2/componentes';
import './unidades.css';
// SOLO TIPOS de `operacion.ts` — misma restricción real que clientes/forma.tsx:
// ese módulo importa `supabaseAdmin`, cuyo encabezado prohíbe acabar en código
// de cliente. Un import de VALOR arrastraría la llave de servicio al bundle
// del navegador; los `import type` se borran al compilar.
import type { UnidadCruda } from '@/lib/likida/operacion';

export type ResultadoForma = { ok: true; mensaje: string } | { ok: false; error: string } | null;
export type AccionForma = (previo: ResultadoForma, fd: FormData) => Promise<ResultadoForma>;

function BotonGuardar({ etiqueta }: { etiqueta: string }) {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} icono={<Icono icono={Save} />} className="rv-un__guardar">
      {pending ? 'Guardando…' : etiqueta}
    </Boton>
  );
}

/** El aviso del resultado: el UNICO del panel (`admin/ui/aviso-resultado`). El
 *  error se enseña VERBATIM: los `DatoInvalido` de `validarUnidad` están escritos
 *  para leerse aquí. */
const Aviso = AvisoResultado;

/** Un patio, como llega del servidor: solo id y nombre. */
export interface PatioOpcion { id: string; nombre: string }

/**
 * Alta y edición de una unidad, EL MISMO formulario (patrón de clientes).
 *
 * `id` vacío = alta. El `id` oculto dice QUÉ fila, nunca DE QUIÉN: el server
 * action re-resuelve el tenant de la sesión y `editarUnidad` ancla el UPDATE
 * con `.eq('tenant_id', ...)` Y comprueba filas afectadas — el id de una
 * unidad de otra flota sale como error, no como "guardado".
 *
 * CERO CAMPOS DE DINERO a propósito: esta página es del área `operacion` y
 * `dinero_por_area.test.ts` vigila que ahí no se pinte un peso.
 */
/** Un proveedor de rastreo, como llega del servidor: SOLO id y nombre. El
 *  catálogo entero (`CONECTORES_GPS`) trae los `probar()` y las fuentes de
 *  cada fabricante, y nada de eso tiene que hacer en el bundle del navegador
 *  — misma decisión que `GrupoCaptura` en la pantalla de Conexiones. */
export interface ProveedorGps { id: string; nombre: string }

export function FormaUnidad({ accion, id = '', inicial, idPrefijo, proveedoresGps, gpsVistoEn = null, patios = [], terminalId = '', patioFijo = false }: {
  accion: AccionForma;
  id?: string;
  inicial: UnidadCruda;
  /** Prefijo para los `id` del DOM: esta forma se repite por unidad y dos
   *  `<label for="placas">` en la misma página apuntan al primero. */
  idPrefijo: string;
  proveedoresGps: ProveedorGps[];
  /** Cuándo entró la última posición de ESTA unidad, o `null` si nunca. Se
   *  enseña junto al amarre porque es lo único que prueba que funciona. */
  gpsVistoEn?: string | null;
  /** Los patios de la flota (W2). Vacío = ninguno creado: el selector no se pinta. */
  patios?: PatioOpcion[];
  /** El patio actual de la unidad (uuid), o `''` = sin patio. */
  terminalId?: string;
  /** Un jefe con patio no mueve unidades a otro patio: el selector se enseña
   *  bloqueado (el servidor lo vuelve a exigir). En el ALTA se crea en su patio. */
  patioFijo?: boolean;
}) {
  const [estado, despachar] = useActionState(accion, null);
  const campo = (n: string) => `${idPrefijo}-${n}`;

  return (
    <form action={despachar} className="rv-forma">
      <input type="hidden" name="id" value={id} />

      <div className="rv-forma__rejilla">
        <CampoTexto id={campo('eco')} name="numeroEconomico" etiqueta="Número económico" obligatorio maxLength={40}
          defaultValue={inicial.numeroEconomico} placeholder="47, T-102…"
          ayuda="Como la flota la llama en la radio y en el papel. No se puede repetir." />
        <CampoTexto id={campo('placas')} name="placas" etiqueta="Placas" maxLength={20} defaultValue={inicial.placas} placeholder="Opcional" />
        <CampoTexto id={campo('marca')} name="marca" etiqueta="Marca" maxLength={60} defaultValue={inicial.marca} placeholder="Kenworth" />
        <CampoTexto id={campo('modelo')} name="modelo" etiqueta="Modelo" maxLength={60} defaultValue={inicial.modelo} placeholder="T680" />

        {patios.length > 0 && (
          <>
            <CampoSelect id={campo('terminalId')} name="terminalId" etiqueta="Patio" defaultValue={terminalId} disabled={patioFijo}
              ayuda={patioFijo ? 'Solo quien administra la flota mueve una unidad de patio.' : 'Con el patio, su jefe de tráfico la ve y la corrige.'}>
              <option value="">Sin patio</option>
              {patios.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </CampoSelect>
            {patioFijo && <input type="hidden" name="terminalId" value={terminalId} />}
          </>
        )}

        <CampoTexto id={campo('anio')} name="anio" tipo="number" etiqueta="Año" min={1950} step={1}
          defaultValue={inicial.anio} placeholder="Déjalo vacío si no lo sabes" />
      </div>

      {/* LAS TRES VIGENCIAS DE LEY: de otra naturaleza que lo de arriba (identifica al camión; esto decide si HOY puede salir a
          carretera). Vacío = sin capturar, y la unidad sale como "sin papeles" — nunca como vigente, que sería inventar que está en regla. */}
      <Fieldset leyenda="Vigencias · opcionales" ayuda="Con las fechas capturadas, Likida avisa cuál papel vence primero, antes de que lo haga un inspector.">
        <div className="rv-un__tres">
          <CampoFecha id={campo('poliza')} name="polizaVence" etiqueta="Póliza vence" defaultValue={inicial.polizaVence} />
          <CampoFecha id={campo('sict')} name="permisoSictVence" etiqueta="Permiso SICT vence" defaultValue={inicial.permisoSictVence} />
          <CampoFecha id={campo('verif')} name="verificacionVence" etiqueta="Verificación vence" defaultValue={inicial.verificacionVence} />
        </div>
      </Fieldset>

      {/* EL AMARRE CON EL GPS (columnas de la 0176): el poller busca la unidad por (flota, proveedor, dispositivo); sin estos dos
          campos las posiciones del proveedor se cuentan como HUÉRFANAS y se descartan. Van juntos o no van (`validarAmarreGps`). */}
      <Fieldset leyenda="Rastreo GPS · opcional"
        ayuda={gpsVistoEn
          // Se dice cuándo, no «conectado»: la marca la pone el poller al asentar una lectura de verdad.
          ? `El GPS está entrando: la última posición de esta unidad llegó el ${gpsVistoEn.slice(0, 10)}.`
          : 'Todavía no ha llegado una sola posición de esta unidad. El rastreo se actualiza cada 5 minutos y solo trae lo de las unidades ligadas.'}>
        <div className="rv-forma__rejilla">
          <CampoSelect id={campo('gpsprov')} name="gpsProveedor" etiqueta="Proveedor de rastreo" defaultValue={inicial.gpsProveedor}
            ayuda="El mismo que capturaste en Conexiones. Si no está aquí, es que su credencial todavía no se guardó.">
            <option value="">Sin GPS conectado</option>
            {proveedoresGps.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre}</option>
            ))}
          </CampoSelect>
          <CampoTexto id={campo('gpsdev')} name="gpsDeviceId" etiqueta="Número de dispositivo" maxLength={200}
            defaultValue={inicial.gpsDeviceId} placeholder="El id que le da tu proveedor"
            ayuda="Es el id del vehículo en el sistema de tu proveedor, no las placas. Un dispositivo solo puede estar en un camión." />
        </div>
      </Fieldset>

      <Aviso estado={estado} />
      <BotonGuardar etiqueta={id ? 'Guardar cambios' : 'Dar de alta'} />
    </form>
  );
}
