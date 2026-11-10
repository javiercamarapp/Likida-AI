'use client';

import { useEffect } from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { FileUp } from 'lucide-react';
import { AvisoCompacto, Boton, CampoArchivo, Icono } from '@/app/ui-v2/componentes';
import './registro.css';
import { validarArchivoElegido } from '@/lib/http/subidas_formulario';
import { frasesSeguimiento } from '@/lib/likida/importacion/resultado_ui';

export interface ResultadoImportarUI {
  error?: string;
  resumen?: {
    creados: number;
    saltados: number;
    descartadas: Array<{ fila: number; motivo: string }>;
    operadoresSinAmarrar: string[];
    /** Folios sin operador amarrable — NO se crean (operador_id es NOT NULL). */
    sinOperador: string[];
    /** Folios saltados porque su operador ya trae un viaje abierto (0029). */
    operadorOcupado: string[];
    unidadOcupada?: string[];
    /** A37-S64-01: filas que la base rechazó por dato inválido (fecha o importe fuera de rango). */
    rechazadasPorBase?: Array<{ folio: string; codigo: string }>;
    /** Números económicos del archivo que no existen en Unidades. */
    unidadesSinAmarrar: string[];
    /** Folios NO creados porque su unidad no se pudo amarrar. */
    sinUnidad: string[];
    /** Nombres de cliente del archivo que no existen en Clientes y tarifas. */
    clientesSinAmarrar: string[];
    /** Folios NO creados porque su cliente no se pudo amarrar. */
    sinCliente: string[];
    /** Seguimiento del agente (T-A5-04): ausentes si no se intentó. */
    seguimientoActivado?: number;
    seguimientoOmitidoSinVoluntario?: number;
    seguimientoNoDisponible?: boolean;
  };
}

export type AccionImportar = (prev: ResultadoImportarUI | null, fd: FormData) => Promise<ResultadoImportarUI | null>;

/**
 * El export del TMS (CSV/Excel) entra al Registro — el kit del PoC: sin
 * esto, el conciliador de peajes no tiene contra qué cruzar. La lectura y
 * la inserción viven en el servidor; NADIE recibe WhatsApp por un import.
 */
export function ImportarViajes({ importar, verDinero = false }: { importar: AccionImportar; verDinero?: boolean }) {
  const [estado, accion] = useActionState(importar, null);
  const router = useRouter();

  useEffect(() => {
    if (estado?.resumen) router.refresh();
  }, [estado, router]);

  const r = estado?.resumen;

  return (
    <div className="rv-imp">
      <form action={accion} className="rv-imp__forma">
        <CampoArchivo etiqueta="CSV o Excel con los viajes" etiquetaOculta name="archivo" accept=".csv,.xlsx,.xls" required
          onChange={(e) => validarArchivoElegido(e.currentTarget)} />
        <BotonImportar />
      </form>
      <p className="rv-reg__nota">
        Máximo 4 MB por archivo.{' '}
        {verDinero ? <>
          Columnas: folio (obligatoria), origen, destino, fecha, anticipo, operador, unidad, cliente, ingreso, km.
          La unidad y el cliente se amarran contra el catálogo; ingreso vacío no es cero.
        </> : <>
          Columnas: folio (obligatoria), origen, destino, fecha, operador, unidad y km.
          Sube únicamente estas columnas operativas. La unidad se amarra contra su catálogo.
        </>}{' '}
        Sin avisos de WhatsApp; los folios que ya existen se saltan solos.
      </p>
      {estado?.error && <AvisoCompacto tono="error" resumen={estado.error} />}
      {r && (
        <div className="rv-imp__res">
          <p>
            <strong className="rv-reg__mono">{r.creados}</strong> viajes creados
            {r.saltados > 0 && <> · {r.saltados} saltados (el folio ya existía)</>}
            {r.descartadas.length > 0 && <span className="rv-imp__warn"> · {r.descartadas.length} filas descartadas</span>}
          </p>
          {frasesSeguimiento(r).length > 0 && <p data-testid="seguimiento-agente">{frasesSeguimiento(r).join(' ')}</p>}
          {r.descartadas.slice(0, 5).map((d) => (
            <p key={d.fila} className="rv-imp__warn">fila {d.fila}: {d.motivo}</p>
          ))}
          {r.descartadas.length > 5 && <p>y {r.descartadas.length - 5} más.</p>}
          {r.sinOperador.length > 0 && (
            <p className="rv-imp__warn">
              {r.sinOperador.length === 1 ? '1 viaje NO se creó' : `${r.sinOperador.length} viajes NO se crearon`} por
              no traer operador amarrable ({r.sinOperador.join(', ')})
              {r.operadoresSinAmarrar.length > 0 && <> — nombres sin amarrar: {r.operadoresSinAmarrar.join(', ')}</>}.
              Da de alta o corrige el nombre en Operadores y vuelve a subir el archivo: los ya creados se saltan solos.
            </p>
          )}
          {r.operadorOcupado.length > 0 && (
            <p className="rv-imp__warn">
              {r.operadorOcupado.length === 1 ? '1 viaje saltado' : `${r.operadorOcupado.length} viajes saltados`} porque
              su operador ya trae un viaje abierto ({r.operadorOcupado.join(', ')}) — ciérralo o liquídalo primero.
            </p>
          )}
          {(r.unidadOcupada?.length ?? 0) > 0 && (
            <p className="rv-imp__warn">
              {r.unidadOcupada!.length === 1 ? '1 viaje saltado' : `${r.unidadOcupada!.length} viajes saltados`} porque
              su unidad ya tiene un viaje abierto ({r.unidadOcupada!.join(', ')}): ciérralo o reasígnalo antes de importar este.
            </p>
          )}
          {(r.rechazadasPorBase?.length ?? 0) > 0 && (
            <p className="rv-imp__warn">
              {r.rechazadasPorBase!.length === 1 ? '1 viaje NO se creó' : `${r.rechazadasPorBase!.length} viajes NO se crearon`} porque
              la base rechazó su fecha o un importe ({r.rechazadasPorBase!.map((x) => x.folio).join(', ')}). Corrige esas filas y vuelve a subir el archivo: los ya creados se saltan solos.
            </p>
          )}
          {r.sinUnidad.length > 0 && (
            <p className="rv-imp__warn">
              {r.sinUnidad.length === 1 ? '1 viaje NO se creó' : `${r.sinUnidad.length} viajes NO se crearon`} porque
              su unidad no está dada de alta ({r.sinUnidad.join(', ')})
              {r.unidadesSinAmarrar.length > 0 && <> — números sin amarrar: {r.unidadesSinAmarrar.join(', ')}</>}.
              Regístrala en Unidades y vuelve a subir el archivo: los ya creados se saltan solos.
            </p>
          )}
          {verDinero && r.sinCliente.length > 0 && (
            <p className="rv-imp__warn">
              {r.sinCliente.length === 1 ? '1 viaje NO se creó' : `${r.sinCliente.length} viajes NO se crearon`} porque
              su cliente no está dado de alta ({r.sinCliente.join(', ')})
              {r.clientesSinAmarrar.length > 0 && <> — nombres sin amarrar: {r.clientesSinAmarrar.join(', ')}</>}.
              Regístralo en Clientes y tarifas y vuelve a subir el archivo.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function BotonImportar() {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" disabled={pending} icono={<Icono icono={FileUp} tam={16} />}>
      {pending ? 'Importando…' : 'Importar viajes'}
    </Boton>
  );
}
