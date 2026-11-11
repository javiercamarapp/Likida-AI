'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Inbox } from 'lucide-react';
import { numero } from '@/lib/formato';
import { Boton, Drawer } from '../../ui-v2/componentes';
import './tablero.css';
import { useT } from '@/lib/i18n/proveedor';
import { admin_sistema as admin_sistemaEs } from '@/lib/i18n/es/admin_sistema';
import { estadoProspectoTr, nombreEtapaTr } from '@/lib/i18n/rotulos_tr';

// ═══════════════════════════════════════════════════════════════════════════
// EL TABLERO KANBAN DEL PIPELINE — compartido entre /admin/vendedores (todo
// el censo, con asignar) y /vendedor (solo SUS tarjetas, sin asignar).
//
// SIN drag&drop a propósito: una librería nueva es una dependencia que nadie
// pidió, y los botones de mover llegan igual de rápido con teclado y con
// dedo. Cada acción es un server action + revalidatePath; `useTransition`
// mantiene el tablero vivo mientras el servidor confirma, y el error se
// enseña EN la tarjeta que falló — no en un toast que desaparece.
//
// TODO LO QUE DECIDE VIVE EN EL SERVIDOR. Este componente recibe columnas ya
// filtradas y recortadas, el mapa de transiciones y los catálogos COMO
// PROPS (patrón `MODOS_TARIFA`): importar `vendedores.ts` aquí arrastraría
// `supabaseAdmin` al bundle del navegador. Y aunque los botones solo
// ofrecen transiciones válidas, el servidor las re-valida — un botón
// escondido no es una regla.
// ═══════════════════════════════════════════════════════════════════════════

export interface TarjetaProspecto {
  id: string;
  empresa: string;
  vacante: string | null;
  ciudad: string | null;
  notas: string | null;
  estado: string;
  vendedorId: string | null;
  /** Resuelto por el servidor; `null` = sin asignar. */
  vendedorNombre: string | null;
}

export interface ColumnaTablero {
  estado: string;
  rotulo: string;
  /** La cifra REAL de la columna (con filtros aplicados), aunque abajo solo
   *  se pinten `tarjetas.length` — el recorte se dice, nunca se esconde. */
  total: number;
  tarjetas: TarjetaProspecto[];
  /** FE-10: a dónde lleva "ver los que faltan" cuando la columna está
   *  recortada. El tablero decía "y N más — filtra para verlos" en una
   *  pantalla que NO TIENE filtro (/vendedor): mandaba a usar algo que no
   *  existe. Con `mas` se pinta un link real; sin él, el texto se limita a
   *  declarar el recorte. */
  mas?: { href: string; etiqueta: string } | null;
  /** El link de vuelta cuando la columna está EXPANDIDA (misma razón). */
  menos?: { href: string; etiqueta: string } | null;
}

export type ResultadoAccion = { ok: true; mensaje?: string } | { ok: false; error: string };

type Tono = 'ok' | 'warn' | 'bad' | 'neutral';

/** El tinte del pill por etapa: color + texto siempre, nunca color solo. */
const PILL_COLUMNA: Record<string, Tono> = {
  nuevo: 'neutral',
  contactado: 'neutral',
  appointment: 'warn',
  rescheduled: 'warn',
  cancelled: 'bad',
  'no-show': 'bad',
  demo: 'warn',
  proposal: 'warn',
  pilot: 'warn',
  won: 'ok',
  lost: 'bad',
  // Solo pueden llegar como estado de una tarjeta histórica; la columna ya
  // usa su nombre canónico.
  negociacion: 'warn',
  cerrado: 'ok',
  perdido: 'bad',
};

function Tarjeta({
  t, orden, transiciones, rotulos, vendedores, mover, asignar, guardarNota, redactar, conVendedor,
}: {
  t: TarjetaProspecto;
  orden: string[];
  transiciones: Record<string, readonly string[]>;
  rotulos: Record<string, string>;
  vendedores: Array<{ id: string; nombre: string }>;
  mover: (id: string, a: string) => Promise<ResultadoAccion>;
  asignar?: (id: string, vendedorId: string) => Promise<ResultadoAccion>;
  guardarNota?: (id: string, nota: string) => Promise<ResultadoAccion>;
  /** El Redactor (C5, Fase 2): arma el primer correo y lo deja EN LA COLA de
   *  aprobación — jamás lo envía. Solo /admin lo pasa. */
  redactar?: (id: string) => Promise<ResultadoAccion>;
  conVendedor: boolean;
}) {
  const { t: tr } = useT('admin_sistema', admin_sistemaEs);
  const [pendiente, empezar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  const [nota, setNota] = useState(t.notas ?? '');

  const correr = (accion: () => Promise<ResultadoAccion>) => {
    setError(null);
    setHecho(null);
    empezar(async () => {
      const r = await accion();
      if (!r.ok) setError(r.error);
      else if (r.mensaje) setHecho(r.mensaje);
    });
  };

  const destinos = transiciones[t.estado] ?? [];
  const idx = orden.indexOf(t.estado);
  const [abierto, setAbierto] = useState(false);
  const etiquetaDe = (a: string): string => {
    if (a === 'lost' || a === 'perdido') return nombreEtapaTr('perdido', tr);
    if (a === 'won' || a === 'cerrado') return nombreEtapaTr('won', tr);
    const r = estadoProspectoTr(a, tr, rotulos[a]);
    return orden.indexOf(a) < idx ? `← ${r}` : `${r} →`;
  };

  return (
    <div className="ven-tarjeta" data-pendiente={pendiente || undefined}>
      {/* La tarjeta es un botón: el detalle (mover, asignar, nota, redactar) vive en el cajón, como en Rovaq. */}
      <Boton variante="ghost" className="ven-tarjeta__abrir" onClick={() => setAbierto(true)} aria-haspopup="dialog">
        <span className="ven-tarjeta__empresa">{t.empresa}</span>
        {/* La vacante es LA señal del censo: si existe, se enseña siempre. */}
        {t.vacante && <span className="ven-tarjeta__tenue">{tr('mapa_prospectos_cerebro.vacante')}{' '}{t.vacante}</span>}
        {(t.ciudad || conVendedor) && (
          <span className="ven-tarjeta__linea">
            {t.ciudad && <span>{t.ciudad}</span>}
            {t.ciudad && conVendedor && <span aria-hidden>·</span>}
            {conVendedor && <span>{t.vendedorNombre ?? tr('vendedores_consola_vendedores.sin_asignar')}</span>}
          </span>
        )}
        {t.notas && <span className="ven-tarjeta__tenue ven-tarjeta__tenue--fino">{t.notas}</span>}
      </Boton>

      <Drawer abierto={abierto} onCerrar={() => setAbierto(false)} titulo={t.empresa}
        descripcion={[t.vacante ? `Vacante: ${t.vacante}` : null, t.ciudad].filter(Boolean).join(' · ') || undefined}>
        <div className="ven-detalle">
          {destinos.length > 0 && (
            <div className="ven-tarjeta__acciones">
              {destinos.map((a) => (
                <Boton key={a} tamano="sm" disabled={pendiente}
                  variante={a === 'lost' || a === 'perdido' ? 'danger-soft' : a === 'won' || a === 'cerrado' ? 'primary' : 'secondary'}
                  onClick={() => correr(() => mover(t.id, a))}>
                  {etiquetaDe(a)}
                </Boton>
              ))}
            </div>
          )}

          {/* El Redactor solo para etapas vivas: el servidor lo re-valida (un botón escondido no es una regla, misma nota del encabezado). */}
          {redactar && !['won', 'lost', 'cerrado', 'perdido'].includes(t.estado) && (
            <Boton tamano="sm" disabled={pendiente} className="ven-btn--ancho" onClick={() => correr(() => redactar(t.id))}>
              {pendiente ? tr('mapa_prospectos_detalle.redactando') : tr('vendedores_tablero.redactar_correo_cola_de_aprobacion')}
            </Boton>
          )}

          {hecho && <p className="ven-tarjeta__ok">{hecho}</p>}

          {asignar && (
            <select aria-label={tr('vendedores_tablero.vendedor_de', { empresa: t.empresa })} value={t.vendedorId ?? ''} disabled={pendiente} className="ven-select"
              onChange={(e) => correr(() => asignar(t.id, e.target.value))}>
              <option value="">{tr('vendedores_consola_vendedores.sin_asignar')}</option>
              {vendedores.map((v) => (
                <option key={v.id} value={v.id}>{v.nombre}</option>
              ))}
            </select>
          )}

          {guardarNota && (
            <div className="ven-nota">
              <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={4} maxLength={2000} aria-label={tr('vendedores_tablero.nota_de', { empresa: t.empresa })} />
              <Boton tamano="sm" disabled={pendiente} onClick={() => correr(() => guardarNota(t.id, nota))}>{tr('vendedores_tablero.guardar_nota')}</Boton>
            </div>
          )}

          {error && <p className="ven-tarjeta__error" role="alert">{error}</p>}
        </div>
      </Drawer>
    </div>
  );
}

export function TableroProspectos({
  columnas, orden, transiciones, rotulos, vendedores, mover, asignar, guardarNota, redactar, hayFiltro = false,
  conVendedor = true,
}: {
  columnas: ColumnaTablero[];
  /** El embudo en orden, para decidir qué botón es ← y cuál →. */
  orden: string[];
  transiciones: Record<string, readonly string[]>;
  rotulos: Record<string, string>;
  vendedores: Array<{ id: string; nombre: string }>;
  mover: (id: string, a: string) => Promise<ResultadoAccion>;
  /** Ausente en /vendedor: asignar es del admin. */
  asignar?: (id: string, vendedorId: string) => Promise<ResultadoAccion>;
  guardarNota?: (id: string, nota: string) => Promise<ResultadoAccion>;
  /** El Redactor (C5) — ausente en /vendedor por ahora: aprobar es de /admin. */
  redactar?: (id: string) => Promise<ResultadoAccion>;
  /** Con filtros activos, la columna vacía dice la verdad completa: vacía
   *  BAJO ESTE FILTRO, no vacía en el negocio. */
  hayFiltro?: boolean;
  /** `false` en el tablero PROPIO del vendedor: todas las tarjetas son
   *  suyas, y pintarle "Sin asignar" (el `null` de un nombre que no viaja)
   *  sería mentirle sobre su propia cartera. */
  conVendedor?: boolean;
}) {
  const { t, idioma } = useT('admin_sistema', admin_sistemaEs);
  // Todas las etapas vacías: UNA sola pista honesta en vez de once columnas repitiendo lo mismo.
  if (columnas.every((c) => c.tarjetas.length === 0 && c.total === 0)) {
    return (
      <p className="ven-vacio">
        {hayFiltro
          ? t('vendedores_tablero.ningun_prospecto_coincide_con_el_filtro')
          : t('vendedores_tablero.ninguna_etapa_tiene_prospectos_todavia')}
      </p>
    );
  }
  return (
    // El tablero scrollea DENTRO de su contenedor (regla de wide content): seis columnas no caben en un portátil y la página no debe
    // crecer a lo ancho por ellas.
    <div className="ven-tablero">
      <div className="ven-tablero__fila">
        {columnas.map((col) => (
          <div key={col.estado} className="ven-col">
            <div className="ven-col__cab">
              <span className="ven-pill" data-tono={PILL_COLUMNA[col.estado] ?? 'neutral'}>{estadoProspectoTr(col.estado, t, col.rotulo)}</span>
              <span className="ven-col__total">{numero(col.total, idioma)}</span>
            </div>
            <div className="ven-col__cuerpo">
              {col.tarjetas.length === 0 ? (
                // R9: una línea sobria por columna vacía (antes una tarjeta «Sin datos por ahora» repetida en cada etapa).
                <p className="ven-col__vacia">
                  <Inbox width={13} height={13} strokeWidth={1.75} aria-hidden="true" />
                  {hayFiltro
                    ? t('vendedores_tablero.ninguno_en_esta_etapa_con_el')
                    : t('vendedores_tablero.sin_prospectos_en_esta_etapa')}
                </p>
              ) : (
                col.tarjetas.map((t) => (
                  <Tarjeta key={t.id} t={t} orden={orden} transiciones={transiciones} rotulos={rotulos}
                    vendedores={vendedores} mover={mover} asignar={asignar} guardarNota={guardarNota}
                    redactar={redactar} conVendedor={conVendedor} />
                ))
              )}
              {col.mas ? (
                <Link href={col.mas.href} className="ven-col__mas">{col.mas.etiqueta}</Link>
              ) : col.total > col.tarjetas.length ? (
                <p className="ven-col__recorte">{t('vendedores_tablero.y_mas', { v: col.total - col.tarjetas.length })}{hayFiltro ? t('vendedores_tablero.acota_el_filtro_para_verlos') : ''}
                </p>
              ) : null}
              {col.menos && (
                <Link href={col.menos.href} className="ven-col__mas">{col.menos.etiqueta}</Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
