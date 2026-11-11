'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { numero } from '@/lib/formato';
import { Boton, Drawer, TablaBase, type ColumnaBase } from '../../ui-v2/componentes';
import '../../ui-v2/esqueletos/esqueletos.css';
import './tablero.css';
import { useT } from '@/lib/i18n/proveedor';
import { admin_sistema as admin_sistemaEs } from '@/lib/i18n/es/admin_sistema';
import { estadoProspectoTr, nombreEtapaTr } from '@/lib/i18n/rotulos_tr';

// ═══════════════════════════════════════════════════════════════════════════
// EL TABLERO DEL PIPELINE (tabla maestra con Vista rápida, plantilla TM de Rovaq) — compartido entre /admin/vendedores (todo
// el censo, con asignar) y /vendedor (solo SUS tarjetas, sin asignar).
//
// Fue un kanban de nueve columnas que se cortaba a la derecha; ahora es UNA
// tabla (empresa, etapa, ciudad, vendedor) con «Vista rápida» ghost por fila y
// un cajón de 420 con el 2×2 de cifras y el pie con la acción primaria. Mismas
// props que el kanban: /vendedor lo monta igual. SIN drag&drop a propósito. Cada acción es un server action + revalidatePath; `useTransition`
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

type Fila = TarjetaProspecto & { orden: number };

/** La etapa en la tabla: píldora MONOCROMA (decisión 10: las etapas son categorías, no semáforos). Ganado va en tinta llena; perdido, hueco. */
function Etapa({ estado, etiqueta }: { estado: string; etiqueta: string }) {
  const fin = estado === 'won' || estado === 'cerrado' ? 'ganado' : estado === 'lost' || estado === 'perdido' ? 'perdido' : undefined;
  return <span className="ven-pill" data-fin={fin}>{etiqueta}</span>;
}

function Detalle({
  t, orden, transiciones, rotulos, vendedores, mover, asignar, guardarNota, redactar, conVendedor, etapa, alMover,
}: {
  t: TarjetaProspecto;
  orden: string[];
  transiciones: Record<string, readonly string[]>;
  rotulos: Record<string, string>;
  vendedores: Array<{ id: string; nombre: string }>;
  mover: (id: string, a: string) => Promise<ResultadoAccion>;
  asignar?: (id: string, vendedorId: string) => Promise<ResultadoAccion>;
  guardarNota?: (id: string, nota: string) => Promise<ResultadoAccion>;
  /** El Redactor (C5, Fase 2): arma el primer correo y lo deja EN LA COLA de aprobación — jamás lo envía. Solo /admin lo pasa. */
  redactar?: (id: string) => Promise<ResultadoAccion>;
  conVendedor: boolean;
  etapa: string;
  alMover: () => void;
}) {
  const { t: tr } = useT('admin_sistema', admin_sistemaEs);
  const [pendiente, empezar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  const [nota, setNota] = useState(t.notas ?? '');

  const correr = (accion: () => Promise<ResultadoAccion>, movio = false) => {
    setError(null);
    setHecho(null);
    empezar(async () => {
      const r = await accion();
      if (!r.ok) setError(r.error);
      else {
        if (r.mensaje) setHecho(r.mensaje);
        if (movio) alMover();
      }
    });
  };

  const destinos = transiciones[t.estado] ?? [];
  const idx = orden.indexOf(t.estado);
  const esPerdido = (a: string) => a === 'lost' || a === 'perdido';
  const esGanado = (a: string) => a === 'won' || a === 'cerrado';
  const etiquetaDe = (a: string): string => {
    if (esPerdido(a)) return nombreEtapaTr('perdido', tr);
    if (esGanado(a)) return nombreEtapaTr('won', tr);
    const r = estadoProspectoTr(a, tr, rotulos[a]);
    return orden.indexOf(a) < idx ? `← ${r}` : `${r} →`;
  };
  // La acción primaria del pie: ganar si se puede; si no, el siguiente paso hacia adelante.
  const primaria = destinos.find(esGanado) ?? destinos.find((a) => !esPerdido(a) && orden.indexOf(a) > idx) ?? null;
  const secundarias = destinos.filter((a) => a !== primaria);
  const sinDato = tr('vendedores_tablero.sin_dato');

  return (
    <>
      <div className="rv-esq__vr-cuerpo ven-detalle">
        <dl className="rv-esq__vr">
          <div><dt>{tr('vendedores_tablero.etapa')}</dt><dd>{etapa}</dd></div>
          {/* En el tablero PROPIO del vendedor todas las tarjetas son suyas: no se le pinta «Sin asignar»; en su lugar, si la tarjeta ya lleva nota. */}
          {conVendedor
            ? <div><dt>{tr('vendedores_consola_vendedores.vendedor')}</dt><dd>{t.vendedorNombre ?? tr('vendedores_consola_vendedores.sin_asignar')}</dd></div>
            : <div><dt>{tr('vendedores_tablero.nota')}</dt><dd>{t.notas ? tr('vendedores_tablero.con_nota') : tr('vendedores_tablero.sin_nota')}</dd></div>}
          <div><dt>{tr('vendedores_tablero.ciudad')}</dt><dd>{t.ciudad ?? sinDato}</dd></div>
          <div><dt>{tr('vendedores_tablero.vacante')}</dt><dd>{t.vacante ?? sinDato}</dd></div>
        </dl>

        {secundarias.length > 0 && (
          <div className="ven-tarjeta__acciones">
            {secundarias.map((a) => (
              <Boton key={a} tamano="sm" disabled={pendiente} variante={esPerdido(a) ? 'danger-soft' : 'secondary'} onClick={() => correr(() => mover(t.id, a), true)}>
                {etiquetaDe(a)}
              </Boton>
            ))}
          </div>
        )}

        {asignar && (
          <label className="ven-campo">
            <span>{tr('vendedores_consola_vendedores.vendedor')}</span>
            <select aria-label={tr('vendedores_tablero.vendedor_de', { empresa: t.empresa })} value={t.vendedorId ?? ''} disabled={pendiente} className="ven-select"
              onChange={(e) => correr(() => asignar(t.id, e.target.value))}>
              <option value="">{tr('vendedores_consola_vendedores.sin_asignar')}</option>
              {vendedores.map((v) => (
                <option key={v.id} value={v.id}>{v.nombre}</option>
              ))}
            </select>
          </label>
        )}

        {guardarNota && (
          <div className="ven-nota">
            <label className="ven-campo">
              <span>{tr('vendedores_tablero.nota')}</span>
              <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={4} maxLength={2000} placeholder={tr('vendedores_tablero.nota_ayuda')} aria-label={tr('vendedores_tablero.nota_de', { empresa: t.empresa })} />
            </label>
            <Boton tamano="sm" disabled={pendiente} onClick={() => correr(() => guardarNota(t.id, nota))}>{tr('vendedores_tablero.guardar_nota')}</Boton>
          </div>
        )}

        {/* El servidor re-valida la etapa: un botón escondido no es una regla. */}
        {redactar && !['won', 'lost', 'cerrado', 'perdido'].includes(t.estado) && (
          <Boton tamano="sm" disabled={pendiente} className="ven-btn--ancho" onClick={() => correr(() => redactar(t.id))}>
            {pendiente ? tr('mapa_prospectos_detalle.redactando') : tr('vendedores_tablero.redactar_correo_cola_de_aprobacion')}
          </Boton>
        )}

        {hecho && <p className="ven-tarjeta__ok">{hecho}</p>}
        {error && <p className="ven-tarjeta__error" role="alert">{error}</p>}
      </div>
      {primaria && (
        <div className="rv-esq__vr-pie ven-detalle__pie">
          <Boton variante="primary" tamano="sm" disabled={pendiente} onClick={() => correr(() => mover(t.id, primaria), true)}>{etiquetaDe(primaria)}</Boton>
        </div>
      )}
    </>
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
  /** Con filtros activos, la columna vacía dice la verdad completa: vacía BAJO ESTE FILTRO, no vacía en el negocio. */
  hayFiltro?: boolean;
  /** `false` en el tablero PROPIO del vendedor: todas las tarjetas son suyas, y pintarle «Sin asignar» (el `null` de un nombre que no viaja)
   *  sería mentirle sobre su propia cartera. */
  conVendedor?: boolean;
}) {
  const { t, idioma } = useT('admin_sistema', admin_sistemaEs);
  const [abierto, setAbierto] = useState<string | null>(null);
  // Todas las etapas vacías: UNA sola pista honesta en vez de una tabla sin filas.
  if (columnas.every((c) => c.tarjetas.length === 0 && c.total === 0)) {
    return (
      <p className="ven-vacio">
        {hayFiltro
          ? t('vendedores_tablero.ningun_prospecto_coincide_con_el_filtro')
          : t('vendedores_tablero.ninguna_etapa_tiene_prospectos_todavia')}
      </p>
    );
  }
  const etiquetaEtapa = (estado: string, rotulo?: string) => estadoProspectoTr(estado, t, rotulo ?? rotulos[estado]);
  const filas: Fila[] = columnas.flatMap((col, i) => col.tarjetas.map((x) => ({ ...x, orden: i })));
  const elegida = filas.find((f) => f.id === abierto) ?? null;

  const cols: ColumnaBase<Fila>[] = [
    { id: 'empresa', titulo: t('vendedores_tablero.empresa'), principal: true, celda: (f) => (
      <span className="ven-celda">
        <span className="ven-celda__nombre">{f.empresa}</span>
        {f.vacante ? <span className="ven-celda__tenue">{t('mapa_prospectos_cerebro.vacante')} {f.vacante}</span> : null}
      </span>
    ) },
    { id: 'etapa', titulo: t('vendedores_tablero.etapa'), celda: (f) => <Etapa estado={f.estado} etiqueta={etiquetaEtapa(f.estado)} /> },
    { id: 'ciudad', titulo: t('vendedores_tablero.ciudad'), celda: (f) => f.ciudad ?? '—' },
    ...(conVendedor ? [{ id: 'vendedor', titulo: t('vendedores_consola_vendedores.vendedor'), celda: (f: Fila) => f.vendedorNombre ?? t('vendedores_consola_vendedores.sin_asignar') }] : []),
    { id: 'ver', titulo: t('vendedores_tablero.vista_rapida'), tituloOculto: true, alinear: 'der', celda: (f) => (
      <Boton variante="ghost" tamano="sm" aria-haspopup="dialog" aria-label={t('vendedores_tablero.vista_rapida_de', { empresa: f.empresa })} onClick={() => setAbierto(f.id)}>{t('vendedores_tablero.vista_rapida')}</Boton>
    ) },
  ];
  // El recorte por etapa se DICE (nunca se esconde): una línea por etapa que no se pintó entera.
  const recortes = columnas.filter((c) => c.mas || c.menos || c.total > c.tarjetas.length);
  const subtitulo = elegida ? [elegida.vacante ? `${t('mapa_prospectos_cerebro.vacante')} ${elegida.vacante}` : null, elegida.ciudad].filter(Boolean).join(' · ') || undefined : undefined;

  return (
    <div className="ven-tablero">
      <TablaBase
        etiqueta={t('vendedores_tablero.prospectos_del_pipeline')}
        columnas={cols} filas={filas} idFila={(f) => f.id} tarjetaMovil
        vacio={{ titulo: hayFiltro ? t('vendedores_tablero.ninguno_en_esta_etapa_con_el') : t('vendedores_tablero.sin_prospectos_en_esta_etapa') }}
      />
      {recortes.length > 0 && (
        <ul className="ven-recortes">
          {recortes.map((col) => (
            <li key={col.estado}>
              <b>{etiquetaEtapa(col.estado, col.rotulo)}</b>{' '}
              {col.total > col.tarjetas.length
                ? <>{numero(col.tarjetas.length, idioma)} / {numero(col.total, idioma)}{hayFiltro ? t('vendedores_tablero.acota_el_filtro_para_verlos') : ''}</>
                : null}
              {col.mas ? <> <Link href={col.mas.href} className="ven-col__mas">{col.mas.etiqueta}</Link></> : null}
              {col.menos ? <> <Link href={col.menos.href} className="ven-col__mas">{col.menos.etiqueta}</Link></> : null}
            </li>
          ))}
        </ul>
      )}
      <Drawer abierto={elegida !== null} onCerrar={() => setAbierto(null)} titulo={elegida?.empresa ?? ''} descripcion={subtitulo} tamano="m">
        {elegida && (
          <Detalle key={elegida.id} t={elegida} orden={orden} transiciones={transiciones} rotulos={rotulos} vendedores={vendedores}
            mover={mover} asignar={asignar} guardarNota={guardarNota} redactar={redactar} conVendedor={conVendedor}
            etapa={etiquetaEtapa(elegida.estado)} alMover={() => setAbierto(null)} />
        )}
      </Drawer>
    </div>
  );
}
