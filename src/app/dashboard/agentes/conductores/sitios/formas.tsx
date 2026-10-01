'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { CheckCircle2, TriangleAlert, Save, Upload } from 'lucide-react';
import { TIPOS_SITIO } from '@/lib/likida/conductor/sitios';

// ═══════════════════════════════════════════════════════════════════════════
// EL EDITOR MÍNIMO DE SITIOS Y EL IMPORTADOR CSV (0385).
//
// NINGUNA coordenada se calcula ni se adivina: se escribe o viene en el archivo. El importador
// es TODO O NADA y dice línea por línea qué corregir.
// ═══════════════════════════════════════════════════════════════════════════

export type ResultadoSitio =
  | { ok: true; mensaje: string }
  | { ok: false; error: string; detalles?: string[] }
  | null;
export type AccionSitio = (previo: ResultadoSitio, fd: FormData) => Promise<ResultadoSitio>;

const CAMPO = 'hairline rounded-lg px-2.5 h-9 text-[13px] outline-none focus:border-[var(--muted)] w-full';
const ETIQUETA = 'block text-[11px] font-medium mb-1';

const TIPO_TEXTO: Record<string, string> = { cliente: 'Cliente', planta: 'Planta', anden: 'Andén', patio: 'Patio', punto_interes: 'Punto de interés' };

function Boton({ texto, icono }: { texto: string; icono: 'guardar' | 'subir' }) {
  const { pending } = useFormStatus();
  const Icono = icono === 'guardar' ? Save : Upload;
  return (
    <button type="submit" disabled={pending}
      className="h-9 px-4 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 transition-opacity hover:opacity-85 disabled:opacity-50"
      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
      <Icono width={14} height={14} strokeWidth={1.75} />{pending ? 'Guardando…' : texto}
    </button>
  );
}

export function Aviso({ r }: { r: ResultadoSitio }) {
  if (!r) return null;
  return r.ok ? (
    <div role="status" className="flex items-center gap-2 text-[12.5px] px-3.5 py-2.5 rounded-lg" style={{ background: 'var(--okbg)', color: 'var(--ok)' }}>
      <CheckCircle2 width={15} height={15} strokeWidth={1.75} />{r.mensaje}
    </div>
  ) : (
    <div role="alert" className="text-[12.5px] px-3.5 py-2.5 rounded-lg" style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
      <div className="flex items-start gap-2"><TriangleAlert width={15} height={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />{r.error}</div>
      {r.detalles && r.detalles.length > 0 && (
        <ul className="mt-2 ml-6 list-disc space-y-0.5">{r.detalles.map((d, i) => <li key={i}>{d}</li>)}</ul>
      )}
    </div>
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
    <form action={enviar} className="space-y-3" aria-label={inicial.id ? 'Editar sitio' : 'Nuevo sitio'}>
      {inicial.id && <input type="hidden" name="id" value={inicial.id} />}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <label><span className={ETIQUETA}>Nombre</span><input name="nombre" defaultValue={inicial.nombre} required maxLength={120} className={CAMPO} /></label>
        <label><span className={ETIQUETA}>Tipo</span>
          <select name="tipo" defaultValue={inicial.tipo} className={CAMPO}>
            {TIPOS_SITIO.map((t) => <option key={t} value={t}>{TIPO_TEXTO[t] ?? t}</option>)}
          </select>
        </label>
        <label><span className={ETIQUETA}>Código en el sistema del cliente (opcional)</span><input name="codigo" defaultValue={inicial.codigo} maxLength={40} className={CAMPO} /></label>
        <label><span className={ETIQUETA}>Latitud (grados decimales)</span><input name="lat" defaultValue={inicial.lat} required inputMode="decimal" placeholder="20.7200" className={CAMPO} /></label>
        <label><span className={ETIQUETA}>Longitud (negativa en México)</span><input name="lng" defaultValue={inicial.lng} required inputMode="decimal" placeholder="-103.3900" className={CAMPO} /></label>
        <label><span className={ETIQUETA}>Radio en metros (25 a 100,000)</span><input name="radio_m" defaultValue={inicial.radio_m} required inputMode="numeric" className={CAMPO} /></label>
        <label className="sm:col-span-2 lg:col-span-3"><span className={ETIQUETA}>Dirección (solo referencia; no se usa para calcular coordenadas)</span><input name="direccion" defaultValue={inicial.direccion} maxLength={200} className={CAMPO} /></label>
        <label><span className={ETIQUETA}>Cliente (opcional)</span>
          <select name="cliente_id" defaultValue={inicial.cliente_id} className={CAMPO}>
            <option value="">—</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <label><span className={ETIQUETA}>Pertenece a (opcional; un andén cuelga de su planta)</span>
          <select name="padre_id" defaultValue={inicial.padre_id} className={CAMPO}>
            <option value="">—</option>{padres.filter((p) => p.id !== inicial.id).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </label>
      </div>
      <div className="flex items-center gap-3 flex-wrap"><Boton texto={inicial.id ? 'Guardar cambios' : 'Crear sitio'} icono="guardar" /></div>
      <Aviso r={estado} />
    </form>
  );
}

export function FormaImportar({ accion }: { accion: AccionSitio }) {
  const [estado, enviar] = useActionState(accion, null);
  return (
    <form action={enviar} className="space-y-3" aria-label="Importar sitios desde CSV" encType="multipart/form-data">
      <label className="block"><span className={ETIQUETA}>Archivo CSV</span>
        <input type="file" name="archivo" accept=".csv,text/csv,text/plain" className="text-[12.5px]" />
      </label>
      <label className="block"><span className={ETIQUETA}>…o pega el contenido</span>
        <textarea name="csv" rows={5} spellCheck={false} className={`${CAMPO} h-auto py-2 font-mono text-[12px]`}
          placeholder={'codigo,nombre,tipo,lat,lng,radio_m\nPL-ZAP,Planta Zapopan,planta,20.7200,-103.3900,300'} />
      </label>
      <label className="block max-w-[28ch]"><span className={ETIQUETA}>Radio por defecto en metros (solo si el archivo no trae la columna)</span>
        <input name="radio_defecto" inputMode="numeric" placeholder="vacío = el archivo manda" className={CAMPO} />
      </label>
      <div className="flex items-center gap-3 flex-wrap"><Boton texto="Importar" icono="subir" /></div>
      <Aviso r={estado} />
    </form>
  );
}
