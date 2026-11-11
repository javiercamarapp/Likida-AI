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
import { useT } from '@/lib/i18n/proveedor';
import { operacion as operacionEs } from '@/lib/i18n/es/operacion';

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
  const { t, tp } = useT('operacion', operacionEs);
  const [estado, accion] = useActionState(importar, null);
  const router = useRouter();

  useEffect(() => {
    if (estado?.resumen) router.refresh();
  }, [estado, router]);

  const r = estado?.resumen;

  return (
    <div className="rv-imp">
      <form action={accion} className="rv-imp__forma">
        <CampoArchivo etiqueta={t('imp.archivo')} etiquetaOculta name="archivo" accept=".csv,.xlsx,.xls" required
          onChange={(e) => validarArchivoElegido(e.currentTarget)} />
        <BotonImportar />
      </form>
      <p className="rv-reg__nota">
        {t('imp.maximo')}{' '}
        {verDinero ? t('imp.cols.dinero') : t('imp.cols.operativo')}{' '}
        {t('imp.sinavisos')}
      </p>
      {estado?.error && <AvisoCompacto tono="error" resumen={estado.error} />}
      {r && (
        <div className="rv-imp__res">
          <p>
            <strong className="rv-reg__mono">{r.creados}</strong> {t('imp.creados')}
            {r.saltados > 0 && <>{t('imp.saltados', { n: r.saltados })}</>}
            {r.descartadas.length > 0 && <span className="rv-imp__warn">{t('imp.descartadas', { n: r.descartadas.length })}</span>}
          </p>
          {frasesSeguimiento(r).length > 0 && <p data-testid="seguimiento-agente">{frasesSeguimiento(r).join(' ')}</p>}
          {r.descartadas.slice(0, 5).map((d) => (
            <p key={d.fila} className="rv-imp__warn">{t('imp.fila', { fila: d.fila, motivo: d.motivo })}</p>
          ))}
          {r.descartadas.length > 5 && <p>{t('imp.masfilas', { n: r.descartadas.length - 5 })}</p>}
          {r.sinOperador.length > 0 && (
            <p className="rv-imp__warn">
              {tp('imp.sinoperador', r.sinOperador.length, {
                folios: r.sinOperador.join(', '),
                extra: r.operadoresSinAmarrar.length > 0 ? t('imp.sinamarrar.nombres', { lista: r.operadoresSinAmarrar.join(', ') }) : '',
              })}
            </p>
          )}
          {r.operadorOcupado.length > 0 && (
            <p className="rv-imp__warn">{tp('imp.opocupado', r.operadorOcupado.length, { folios: r.operadorOcupado.join(', ') })}</p>
          )}
          {(r.unidadOcupada?.length ?? 0) > 0 && (
            <p className="rv-imp__warn">{tp('imp.unocupada', r.unidadOcupada!.length, { folios: r.unidadOcupada!.join(', ') })}</p>
          )}
          {(r.rechazadasPorBase?.length ?? 0) > 0 && (
            <p className="rv-imp__warn">
              {tp('imp.rechazadas', r.rechazadasPorBase!.length, { folios: r.rechazadasPorBase!.map((x) => x.folio).join(', ') })}
            </p>
          )}
          {r.sinUnidad.length > 0 && (
            <p className="rv-imp__warn">
              {tp('imp.sinunidad', r.sinUnidad.length, {
                folios: r.sinUnidad.join(', '),
                extra: r.unidadesSinAmarrar.length > 0 ? t('imp.sinamarrar.numeros', { lista: r.unidadesSinAmarrar.join(', ') }) : '',
              })}
            </p>
          )}
          {verDinero && r.sinCliente.length > 0 && (
            <p className="rv-imp__warn">
              {tp('imp.sincliente', r.sinCliente.length, {
                folios: r.sinCliente.join(', '),
                extra: r.clientesSinAmarrar.length > 0 ? t('imp.sinamarrar.nombres', { lista: r.clientesSinAmarrar.join(', ') }) : '',
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function BotonImportar() {
  const { t } = useT('operacion', operacionEs);
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" disabled={pending} icono={<Icono icono={FileUp} tam={16} />}>
      {pending ? t('imp.importando') : t('imp.importar')}
    </Boton>
  );
}
