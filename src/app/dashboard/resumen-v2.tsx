import { saludo, ahoraMs } from '@/lib/saludo';
import { fechaMx, hoyMx } from '@/lib/formato';
import { Chip, EncabezadoPagina, Tarjeta } from '@/app/ui-v2/componentes';
import { TiraKpi } from '@/app/ui-v2/graficas';
import { leerSenalesAsistente } from '@/lib/likida/asistente/senales';
import type { Insight } from '@/lib/likida/insights/tipos';
import { AvisoSinFlota } from './sin-flota';
import { coberturaDe, filasAtencion, leerDatosResumen, type RangoResumen } from './resumen-datos';
import { FiltrosResumen, ListaAtencion, SiguienteAccion } from './resumen-cliente';
import { itemsKpi, TarjetaCierres, TarjetaDiferencias, TarjetaHizoSolo } from './resumen-tarjetas';

// ═══════════════════════════════════════════════════════════════════════════
// RESUMEN v2 DEL DUEÑO (rediseño, ESTILO-LIKIDA §6): encabezado → barra de periodo (40 px) → tira de 4 KPI → fila 8+4
// («Liquidaciones cerradas por semana» · «Requiere tu atención») → fila 4+4+4 («Diferencias vs recuperado» · «Lo que hizo solo» ·
// «Siguiente mejor acción»). Sin tabla. JAMÁS una cifra inventada: cada número sale de un lector existente; null = «—».
// El asistente vive en el pie del sidebar y en la primera fila de «Requiere tu atención».
// ═══════════════════════════════════════════════════════════════════════════

export async function ResumenV2({
  tenantId, userId, tenantNombre, nombre, tenantExiste, sufijo, soloLectura, veAsistente, veDinero = false, rango = '30', principales = [],
}: {
  tenantId: string;
  userId: string;
  tenantNombre: string | null;
  nombre: string | null;
  tenantExiste: boolean;
  sufijo: string;
  soloLectura: boolean;
  /** ¿Este rol puede abrir /dashboard/puesta-en-marcha? Si no, no se lee ni se pinta nada del asistente. */
  veAsistente: boolean;
  /** ¿Este rol ve el área de dinero? Sin ello no se lee ni se pinta ningún peso. */
  veDinero?: boolean;
  rango?: RangoResumen;
  /** El insight más severo de cada agente que ya tenga lector (puede venir vacío). */
  principales?: readonly Insight[];
}) {
  const diaMx = hoyMx(new Date(ahoraMs()));
  const [d, senales] = await Promise.all([
    leerDatosResumen(tenantId, rango, veDinero),
    veAsistente ? leerSenalesAsistente(tenantId) : Promise.resolve(null),
  ]);
  const filas = filasAtencion(d, principales, sufijo);
  const cob = coberturaDe(d);
  const ambito = `${tenantId}:${userId}`;

  return (
    <main className="rv-res">
      <EncabezadoPagina
        rotulo={tenantNombre ? `Resumen · viendo como superadmin · ${tenantNombre}` : undefined}
        titulo={`${saludo()}, ${nombre ?? 'equipo'}`}
        descripcion="Tus cinco agentes, de un vistazo."
        acciones={<Chip>{fechaMx(diaMx)}</Chip>}
      />

      {!tenantExiste && <AvisoSinFlota tenantId={tenantId} />}

      <FiltrosResumen rango={rango} fuentes={`Fuentes ${cob.ok} de ${cob.total}`} />

      <div className="rv-res__kpis"><TiraKpi items={itemsKpi(d, sufijo)} etiqueta="Tu flota en Likida" /></div>

      <div className="rv-res__fila rv-res__fila--8-4">
        <TarjetaCierres d={d} />
        <Tarjeta titulo="Requiere tu atención" info="resumen.requiere_atencion" className="rv-res__atencion">
          <ListaAtencion filas={filas} senales={senales} ambito={ambito} soloLectura={soloLectura} sufijo={sufijo} />
        </Tarjeta>
      </div>

      <div className="rv-res__fila rv-res__fila--4-4-4">
        <TarjetaDiferencias d={d} />
        <TarjetaHizoSolo d={d} sufijo={sufijo} />
        <Tarjeta titulo="Siguiente mejor acción" info="resumen.siguiente_mejor_accion">
          <SiguienteAccion filas={filas} senales={senales} ambito={ambito} soloLectura={soloLectura} sufijo={sufijo} />
        </Tarjeta>
      </div>
    </main>
  );
}
