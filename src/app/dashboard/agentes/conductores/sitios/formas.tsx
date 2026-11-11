'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Save, Upload } from 'lucide-react';
import '../conductores.css';
import { Aviso as AvisoV2, Boton, CampoArchivo, CampoSelect, CampoTexto, CampoTextarea, Icono } from '@/app/ui-v2/componentes';
import { TIPOS_SITIO } from '@/lib/likida/conductor/sitios';

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

const TIPO_TEXTO: Record<string, string> = { cliente: 'Cliente', planta: 'Planta', anden: 'Andén', patio: 'Patio', punto_interes: 'Punto de interés' };

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

export function FormaSitio({ accion, inicial, clientes, padres }: {
  accion: AccionSitio; inicial: SitioEditable;
  clientes: Array<{ id: string; nombre: string }>; padres: Array<{ id: string; nombre: string }>;
}) {
  const [estado, enviar] = useActionState(accion, null);
  return (
    <form action={enviar} className="rv-cd__pila" aria-label={inicial.id ? 'Editar sitio' : 'Nuevo sitio'}>
      {inicial.id && <input type="hidden" name="id" value={inicial.id} />}
      <div className="rv-cd__cuad">
        <CampoTexto etiqueta="Nombre" name="nombre" defaultValue={inicial.nombre} required maxLength={120} />
        <CampoSelect etiqueta="Tipo" name="tipo" defaultValue={inicial.tipo}>
          {TIPOS_SITIO.map((t) => <option key={t} value={t}>{TIPO_TEXTO[t] ?? t}</option>)}
        </CampoSelect>
        <CampoTexto etiqueta="Código en el sistema del cliente (opcional)" name="codigo" defaultValue={inicial.codigo} maxLength={40} />
        <CampoTexto etiqueta="Latitud (grados decimales)" name="lat" defaultValue={inicial.lat} required inputMode="decimal" placeholder="20.7200" />
        <CampoTexto etiqueta="Longitud (negativa en México)" name="lng" defaultValue={inicial.lng} required inputMode="decimal" placeholder="-103.3900" />
        <CampoTexto etiqueta="Radio en metros (25 a 100,000)" name="radio_m" defaultValue={inicial.radio_m} required inputMode="numeric" />
        <CampoTexto etiqueta="Dirección (solo referencia; no se usa para calcular coordenadas)" name="direccion" defaultValue={inicial.direccion} maxLength={200} />
        <CampoSelect etiqueta="Cliente (opcional)" name="cliente_id" defaultValue={inicial.cliente_id}>
          <option value="">—</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </CampoSelect>
        <CampoSelect etiqueta="Pertenece a (opcional; un andén cuelga de su planta)" name="padre_id" defaultValue={inicial.padre_id}>
          <option value="">—</option>{padres.filter((p) => p.id !== inicial.id).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </CampoSelect>
      </div>
      <div className="rv-cd__linea"><Boton1 texto={inicial.id ? 'Guardar cambios' : 'Crear sitio'} icono="guardar" /></div>
      <Aviso r={estado} />
    </form>
  );
}

export function FormaImportar({ accion }: { accion: AccionSitio }) {
  const [estado, enviar] = useActionState(accion, null);
  return (
    <form action={enviar} className="rv-cd__form" aria-label="Importar sitios desde CSV" encType="multipart/form-data">
      <CampoArchivo etiqueta="Archivo CSV" name="archivo" accept=".csv,text/csv,text/plain" />
      <CampoTextarea etiqueta="…o pega el contenido" name="csv" rows={5} spellCheck={false} claseControl="rv-cd__mono"
        placeholder={'codigo,nombre,tipo,lat,lng,radio_m\nPL-ZAP,Planta Zapopan,planta,20.7200,-103.3900,300'} />
      <CampoTexto etiqueta="Radio por defecto en metros (solo si el archivo no trae la columna)" name="radio_defecto" inputMode="numeric" placeholder="vacío = el archivo manda" />
      <div className="rv-cd__linea"><Boton1 texto="Importar" icono="subir" /></div>
      <Aviso r={estado} />
    </form>
  );
}
