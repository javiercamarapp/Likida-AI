import { FileUp, Users } from 'lucide-react';
import { AvisoCompacto, Boton, CampoArchivo, CampoTexto, Icono } from '@/app/ui-v2/componentes';
import { CajonCarga } from './cajon-carga';
import './liquidacion.css';
import '../agentes.css';
import { ZonaSoltar } from '../zona-soltar';
import { type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
import { rico as ricoT } from '@/lib/i18n/rico';

// ═══════════════════════════════════════════════════════════════════════════
// CARGAS POR ARCHIVO DEL AGENTE DE LIQUIDACIÓN POR CORREO (Ola 1 · A1).
//
// Mientras el sistema de transporte del cliente no dé su API, la oficina puede:
//   1. subir el export de bitácoras (CSV/Excel, una fila por concepto) — entra por el MISMO camino que `POST /v1/liquidaciones-
//      externas/desgloses`: idempotente, con las mismas guardas (póliza, neto negativo, tipo de operador…) y el mismo Excel;
//   2. subir los correos de los operadores y sus coordinadores (`numero_empleado;correo;coordinador_nombre;coordinador_correo`):
//      nunca crea operadores, solo pone su correo y su coordinador.
// Server component sin JavaScript de cliente: un formulario por carga, el resultado vuelve en el aviso de la página.
// ═══════════════════════════════════════════════════════════════════════════

export interface AccionesCargas {
  desgloses: (fd: FormData) => Promise<void>;
  contactos: (fd: FormData) => Promise<void>;
}


export function SeccionCargas({ acciones, aviso, error, detalle, puedeCargar, tr = TR_ES }: {
  acciones: AccionesCargas; aviso: string | null; error: string | null; detalle: string | null; puedeCargar: boolean; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  // Sin permiso: una nota corta (no hay formulario que abrir). Con permiso: el botón «Importar datos» abre un cajón; si la página vuelve de una carga, nace abierto con su resultado.
  if (!puedeCargar) return <span className="rv-liq-sub" id="cargas">{tx('rest.solo_el_dueno_de_la_flota_2')}</span>;
  return (
    <CajonCarga titulo={tx('rest.cargar_desde_un_archivo')} descripcion={tx('rest.mientras_tu_sistema_no_mande_los')} disparador={tx('liquidacion.importar_datos')}
      abiertoInicial={Boolean(aviso || error || detalle)}>
      {aviso && <AvisoCompacto tono="info" resumen={aviso} />}
      {error && <AvisoCompacto tono="error" resumen={error} />}
      {detalle && <p className="rv-liq-sub rv-liq-pre">{detalle}</p>}
      <div className="rv-liq-dos">
        <form action={acciones.desgloses} className="rv-liq-forma">
          {/* sin-info: título de una forma dentro del cajón, no de un recuadro */}
          <h3 className="rv-liq-forma__titulo"><Icono icono={FileUp} />{' '}{tx('rest.desgloses_export_de_bitacoras')}</h3>
          <p className="rv-liq-sub">{tx('rest.csv_o_excel_una_fila_por')}</p>
          <ZonaSoltar><CampoArchivo etiqueta={tx('rest.archivo_de_desgloses')} name="archivo" accept=".csv,.txt,.xlsx,.xls" required /></ZonaSoltar>
          <p className="rv-liq-sub">{tx('rest.primero_pulsa_ver_vista_previa_cuenta')}</p>
          <CampoTexto etiqueta={tx('rest.correos_que_saldran_el_numero_de')} name="correos" inputMode="numeric" autoComplete="off" pattern="[0-9]*" />
          <div className="rv-ag-acciones">
            <Boton type="submit" name="paso" value="previa" variante="secondary" tamano="sm">{tx('rest.ver_vista_previa')}</Boton>
            <Boton type="submit" name="paso" value="subir" variante="primary" tamano="sm">{tx('rest.subir_y_enviar')}</Boton>
          </div>
        </form>
        <form action={acciones.contactos} className="rv-liq-forma">
          <h3 className="rv-liq-forma__titulo"><Icono icono={Users} />{' '}{tx('rest.correos_de_operadores_y_coordinadores')}</h3>
          <p className="rv-liq-sub">{ricoT(tx('rest.csv_o_excel_con_las_columnas'), { code: (c) => <code>{c}</code> })}</p>
          <ZonaSoltar><CampoArchivo etiqueta={tx('rest.archivo_de_correos')} name="archivo" accept=".csv,.txt,.xlsx,.xls" required /></ZonaSoltar>
          <div className="rv-ag-acciones">
            <Boton type="submit" variante="secondary" tamano="sm">{tx('rest.subir_correos')}</Boton>
          </div>
        </form>
      </div>
    </CajonCarga>
  );
}
