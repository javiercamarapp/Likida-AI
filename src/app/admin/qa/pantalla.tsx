import Link from 'next/link';
import { fechaHoraMx, numero, usd, usd4 } from '@/lib/formato';
import { MarcoPagina, Tarjeta, TablaBase, StatusChip, type ColumnaBase } from '@/app/ui-v2/componentes';
import { TiraCifras } from '@/app/ui-v2/graficas';
import type { Estado } from '../ui/kit';
import { resumenVeredicto, type CorridaQA, type EstadoCorrida } from '@/lib/admin/qa-tipos';
import { LanzarForm, type FotoConUrl } from './lanzar-form';
import { BancoVerdad, type UltimaLectura } from './banco-verdad';
import './qa.css';

export const PILL_CORRIDA: Record<EstadoCorrida, { estado: Estado; etiqueta: string }> = {
  pendiente: { estado: 'neutral', etiqueta: 'Pendiente' },
  corriendo: { estado: 'neutral', etiqueta: 'Corriendo' },
  ok: { estado: 'ok', etiqueta: 'OK' },
  parcial: { estado: 'warn', etiqueta: 'Parcial' },
  fallo: { estado: 'bad', etiqueta: 'Fallo' },
  abortada: { estado: 'bad', etiqueta: 'Abortada' },
};

/**
 * LA PANTALLA de /admin/qa (Calidad › Pruebas reales): fotos reales contra el pipeline real. Presentacional a propósito (la página
 * server le pasa los datos ya leídos): así el preview importa el componente REAL. Errores POR FUENTE dichos: jamás un 0 sobre una
 * lectura que falló. El costo es el REAL de `llm_costo`, nunca estimado.
 */
export function PantallaQa({
  fotos, bancoError, corridas, historialError, gastoHoy, gastoError, topeDiaUsd, topeCorridaUsd,
  lecturasIniciales = {}, lecturasError = null,
}: {
  fotos: FotoConUrl[];
  bancoError: string | null;
  corridas: CorridaQA[];
  historialError: string | null;
  gastoHoy: number | null;
  gastoError: string | null;
  topeDiaUsd: number;
  /** El tope POR corrida ($2, config.qa.ts del ejército). Baja desde el
   *  servidor porque ese módulo trae `node:path` y no puede cruzar a 'use
   *  client'. */
  topeCorridaUsd: number;
  /** La última medición del OCR por foto (mig. 0239). Con default para que el
   *  preview de verificación visual pueda montar la pantalla sin base. */
  lecturasIniciales?: Record<string, UltimaLectura>;
  lecturasError?: string | null;
}) {
  const columnas: ColumnaBase<CorridaQA>[] = [
    { id: 'corrida', titulo: 'Corrida', principal: true, celda: (c) => <Link href={`/admin/qa/${c.id}`} className="font-mono">{c.id.slice(0, 8)}</Link> },
    { id: 'escenario', titulo: 'Escenario', celda: (c) => (c.escenario === 'demo_guion' ? 'Guion del demo' : 'Feliz') },
    { id: 'lanzada', titulo: 'Lanzada', celda: (c) => fechaHoraMx(c.creadaEn) },
    {
      id: 'estado', titulo: 'Estado',
      celda: (c) => { const pill = PILL_CORRIDA[c.estado] ?? { estado: 'neutral' as Estado, etiqueta: c.estado }; return <StatusChip tono={pill.estado}>{pill.etiqueta}</StatusChip>; },
    },
    {
      id: 'veredicto', titulo: 'Veredicto', alinear: 'der',
      celda: (c) => { const res = resumenVeredicto(c.veredicto); return res ? `${res.ok} ok · ${res.noVerificado} sin verificar · ${res.fallo} fallo` : '—'; },
    },
    { id: 'costo', titulo: 'Costo real', alinear: 'der', celda: (c) => usd4(c.costoUsdTotal ?? 0) },
  ];

  return (
    <MarcoPagina
      area="Calidad"
      titulo="Calidad"
      apoyo="Pruebas reales: fotos de comprobantes procesadas como en producción, con el costo real de cada corrida."
    >
      <TiraCifras
        etiqueta="Pruebas reales"
        items={[
          bancoError === null
            ? { etiqueta: 'Fotos en el banco', valor: fotos.length, formato: 'entero' }
            : { etiqueta: 'Fotos en el banco', valor: null, estado: 'error', mensaje: `No se pudo leer: ${bancoError}` },
          historialError === null
            ? { etiqueta: 'Corridas lanzadas', valor: corridas.length, formato: 'entero' }
            : { etiqueta: 'Corridas lanzadas', valor: null, estado: 'error', mensaje: `No se pudo leer: ${historialError}` },
          gastoError === null && gastoHoy !== null
            ? { etiqueta: 'Gasto real de hoy', valor: usd4(gastoHoy), nota: `de ${usd(topeDiaUsd)} de tope diario; suma del costo registrado, nunca estimado` }
            : { etiqueta: 'Gasto de hoy', valor: null, estado: 'error', mensaje: `No se pudo leer: ${gastoError ?? 'sin dato'}` },
        ]}
      />

      {/* ── Lanzar una corrida ─────────────────────────────────────────── */}
      <LanzarForm
        fotosIniciales={fotos}
        bancoError={bancoError}
        gastoHoyUsd={gastoHoy}
        gastoError={gastoError}
        topeDiaUsd={topeDiaUsd}
        topeCorridaUsd={topeCorridaUsd}
      />

      {/* ── El banco de comprobantes reales: la ficha de cada foto y la medición del OCR contra ella ── */}
      <BancoVerdad fotos={fotos} bancoError={bancoError} lecturasIniciales={lecturasIniciales} lecturasError={lecturasError} />

      {/* ── El historial ───────────────────────────────────────────────── */}
      {historialError !== null ? null : (
        <Tarjeta
          titulo="Historial de corridas"
          estado={corridas.length === 0 ? 'vacio' : 'ok'}
          mensaje="Todavía no hay corridas"
          detalle="Elige un escenario arriba, marca tus fotos y aprieta «Lanzar corrida»: el veredicto con su evidencia queda aquí, con su costo real."
        >
          <TablaBase etiqueta="Historial de corridas" columnas={columnas} filas={corridas} idFila={(c) => c.id} tarjetaMovil />
          <p className="text-xs rv-qa-mut">
            {numero(corridas.length)} {corridas.length === 1 ? 'corrida' : 'corridas'}, las más nuevas primero. Cada una corrió contra un
            flota de prueba «ZZZ QA …» propia, borrada al terminar salvo que pidas conservarla; jamás contra datos reales.
          </p>
        </Tarjeta>
      )}
    </MarcoPagina>
  );
}

