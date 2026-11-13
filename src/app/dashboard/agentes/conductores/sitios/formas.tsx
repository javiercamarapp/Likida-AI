'use client';

import { useActionState, useEffect, useId, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Save, Upload } from 'lucide-react';
import '../conductores.css';
import { Aviso as AvisoV2, Boton, CampoArchivo, CampoSelect, CampoTexto, CampoTextarea, Drawer, Icono } from '@/app/ui-v2/componentes';
import { TIPOS_SITIO } from '@/lib/likida/conductor/sitios';
import { useT } from '@/lib/i18n/proveedor';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';
import { type TAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';

// ═══════════════════════════════════════════════════════════════════════════
// EL EDITOR MÍNIMO DE SITIOS Y EL IMPORTADOR CSV (0385).
//
// NINGUNA coordenada se calcula ni se adivina: se escribe o viene en el archivo. El importador
// es TODO O NADA y dice línea por línea qué corregir.
// ═══════════════════════════════════════════════════════════════════════════

export type ResultadoSitio =
  | { ok: true; mensaje: string; detalles?: string[] }
  | { ok: false; error: string; detalles?: string[] }
  | null;
export type AccionSitio = (previo: ResultadoSitio, fd: FormData) => Promise<ResultadoSitio>;

const tipoTexto = (tx: TAgentes = TR_ES.t): Record<string, string> => ({ cliente: tx('vigia.vista.cliente'), planta: tx('rest.planta'), anden: tx('rest.anden'), patio: tx('rest.patio'), punto_interes: tx('rest.punto_de_interes') });

function Boton1({ texto, icono }: { texto: string; icono: 'guardar' | 'subir' }) {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} icono={<Icono icono={icono === 'guardar' ? Save : Upload} tam={14} />}>
      {pending ? 'Guardando…' : texto}
    </Boton>
  );
}

export function Aviso({ r }: { r: ResultadoSitio }) {
  if (!r) return null;
  const detalles = r.detalles && r.detalles.length > 0
    ? <ul className="rv-cd__ul">{r.detalles.map((d, i) => <li key={i}>{d}</li>)}</ul>
    : null;
  return (
    <AvisoV2 tono={r.ok ? 'ok' : 'error'}>
      {r.ok ? r.mensaje : r.error}
      {detalles}
    </AvisoV2>
  );
}

export interface SitioEditable {
  id?: string;
  nombre: string; tipo: string; codigo: string; direccion: string; lat: string; lng: string; radio_m: string; cliente_id: string; padre_id: string;
}

export const SITIO_VACIO: SitioEditable = { nombre: '', tipo: 'planta', codigo: '', direccion: '', lat: '', lng: '', radio_m: '300', cliente_id: '', padre_id: '' };

export function FormaSitio({ accion, inicial, clientes, padres, idForma, alOk, alPendiente }: {
  accion: AccionSitio; inicial: SitioEditable;
  clientes: Array<{ id: string; nombre: string }>; padres: Array<{ id: string; nombre: string }>;
  /** En un cajón el envío vive en el pie (`form=idForma`): la forma no pinta su propio botón. */
  idForma?: string; alOk?: () => void; alPendiente?: (p: boolean) => void;
}) {
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, enviar, pendiente] = useActionState(accion, null);
  useEffect(() => { if (estado?.ok) alOk?.(); }, [estado, alOk]);
  useEffect(() => { alPendiente?.(pendiente); }, [pendiente, alPendiente]);
  return (
    <form id={idForma} action={enviar} className="rv-cd__pila" aria-label={inicial.id ? tx('rest.editar_sitio') : tx('rest.nuevo_sitio')}>
      {inicial.id && <input type="hidden" name="id" value={inicial.id} />}
      <div className="rv-cd__cuad">
        <CampoTexto etiqueta={tx('conductores.forma.nombre')} name="nombre" defaultValue={inicial.nombre} required maxLength={120} />
        <CampoSelect etiqueta={tx('rest.tipo')} name="tipo" defaultValue={inicial.tipo}>
          {TIPOS_SITIO.map((t) => <option key={t} value={t}>{tipoTexto(tx)[t] ?? t}</option>)}
        </CampoSelect>
        <CampoTexto etiqueta={tx('rest.codigo_en_el_sistema_del_cliente')} name="codigo" defaultValue={inicial.codigo} maxLength={40} />
        <CampoTexto etiqueta={tx('rest.latitud_grados_decimales')} name="lat" defaultValue={inicial.lat} required inputMode="decimal" placeholder="20.7200" />
        <CampoTexto etiqueta={tx('rest.longitud_negativa_en_mexico')} name="lng" defaultValue={inicial.lng} required inputMode="decimal" placeholder="-103.3900" />
        <CampoTexto etiqueta={tx('rest.radio_en_metros_25_a_100')} name="radio_m" defaultValue={inicial.radio_m} required inputMode="numeric" />
        <CampoTexto etiqueta={tx('rest.direccion_solo_referencia_no_se_usa')} name="direccion" defaultValue={inicial.direccion} maxLength={200} />
        <CampoSelect etiqueta={tx('rest.cliente_opcional')} name="cliente_id" defaultValue={inicial.cliente_id}>
          <option value="">—</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </CampoSelect>
        <CampoSelect etiqueta={tx('rest.pertenece_a_opcional_un_anden_cuelga')} name="padre_id" defaultValue={inicial.padre_id}>
          <option value="">—</option>{padres.filter((p) => p.id !== inicial.id).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </CampoSelect>
      </div>
      {!idForma && <div className="rv-cd__linea"><Boton1 texto={inicial.id ? tx('rest.guardar_cambios') : tx('rest.crear_sitio')} icono="guardar" /></div>}
      <Aviso r={estado} />
    </form>
  );
}

/**
 * Alta y edición de un sitio en CAJÓN de 420 px (Rovaq `FormaEnCajon`): pie con Cancelar y el primario, Esc cierra, el foco vuelve al
 * disparador. La acción de servidor es la misma de siempre (puerta de permisos y flota atada en `page.tsx`); un rechazo deja el cajón
 * abierto con el aviso, solo `{ ok }` lo cierra. Con `cerrarHref` (edición por `?editar=`) cerrar quita el parámetro de la URL.
 */
export function CajonSitio({ accion, inicial, clientes, padres, disparador, abiertoInicial = false, cerrarHref, variante = 'secondary' }: {
  accion: AccionSitio; inicial: SitioEditable; clientes: Array<{ id: string; nombre: string }>; padres: Array<{ id: string; nombre: string }>;
  disparador?: string; abiertoInicial?: boolean; cerrarHref?: string; variante?: 'primary' | 'secondary';
}) {
  const { t: tx } = useT('agentes', agentesEs);
  const idForma = useId();
  const [abierto, setAbierto] = useState(abiertoInicial);
  const [pendiente, setPendiente] = useState(false);
  const cerrar = () => { setAbierto(false); if (cerrarHref && typeof window !== 'undefined') window.history.replaceState(null, '', cerrarHref); };
  const editar = Boolean(inicial.id);
  return (
    <>
      {disparador ? <Boton type="button" variante={variante} tamano="sm" aria-haspopup="dialog" onClick={() => setAbierto(true)}>{disparador}</Boton> : null}
      <Drawer
        abierto={abierto} onCerrar={cerrar} cierraConFondo={false}
        titulo={editar ? `Editar «${inicial.nombre}»` : tx('rest.nuevo_sitio')}
        pie={(
          <>
            <Boton type="button" variante="ghost" onClick={cerrar}>{tx('f26d4.cajon.cancelar')}</Boton>
            <Boton type="submit" form={idForma} variante="primary" disabled={pendiente} aria-busy={pendiente || undefined}>
              {pendiente ? 'Guardando…' : editar ? tx('rest.guardar_cambios') : tx('rest.crear_sitio')}
            </Boton>
          </>
        )}
      >
        {<FormaSitio key={abierto ? 'abierto' : 'cerrado'} accion={accion} inicial={inicial} clientes={clientes} padres={padres} idForma={idForma} alOk={cerrar} alPendiente={setPendiente} />}
      </Drawer>
    </>
  );
}

export function FormaImportar({ accion }: { accion: AccionSitio }) {
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, enviar] = useActionState(accion, null);
  return (
    <form action={enviar} className="rv-cd__form" aria-label={tx('rest.importar_sitios_desde_csv')} encType="multipart/form-data">
      <CampoArchivo etiqueta={tx('rest.archivo_csv')} name="archivo" accept=".csv,text/csv,text/plain" />
      <CampoTextarea etiqueta={tx('rest.o_pega_el_contenido')} name="csv" rows={5} spellCheck={false} claseControl="rv-cd__mono"
        placeholder={tx('rest.codigo_nombre_tipo_lat_lng_radio')} />
      <CampoTexto etiqueta={tx('rest.radio_por_defecto_en_metros_solo')} name="radio_defecto" inputMode="numeric" placeholder={tx('rest.vacio_el_archivo_manda')} />
      <div className="rv-cd__linea"><Boton1 texto={tx('rest.importar')} icono="subir" /></div>
      <Aviso r={estado} />
    </form>
  );
}
