import { saludo, ahoraMs } from '@/lib/saludo';
import { fechaMx, hoyMx } from '@/lib/formato';
import { Aviso, BotonEnlace, Chip, EncabezadoPagina, Tarjeta } from '@/app/ui-v2/componentes';
import { TiraKpi } from '@/app/ui-v2/graficas';
import { leerSenalesAsistente } from '@/lib/likida/asistente/senales';
import type { AgenteInsight, Insight } from '@/lib/likida/insights/tipos';
import { puedeVerRuta, type PerfilTenant } from '@/lib/auth/visibilidad';
import { AvisoSinFlota } from './sin-flota';
import { ATAJOS_RESUMEN, coberturaDe, filasAtencion, leerDatosResumen, type RangoResumen } from './resumen-datos';
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
  fallidos = [], rol, perfil = null, avisoFiscalPospuesto = false,
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
  /** Agentes cuyo lector de insights FALLÓ: se confiesan en «Requiere tu atención», no se omiten. */
  fallidos?: readonly AgenteInsight[];
  /** Rol efectivo y perfil de la flota: deciden qué enlaces se ofrecen (`puedeVerRuta`) y el rótulo del encabezado. */
  rol: string;
  perfil?: PerfilTenant | null;
  /** Flota normal con el perfil fiscal sin declarar («lo confirmo con mi contador»): el estímulo de peaje sigue en $0. */
  avisoFiscalPospuesto?: boolean;
}) {
  const diaMx = hoyMx(new Date(ahoraMs()));
  const [d, senales] = await Promise.all([
    leerDatosResumen(tenantId, rango, veDinero),
    veAsistente ? leerSenalesAsistente(tenantId) : Promise.resolve(null),
  ]);
  // Ningún enlace de la pantalla rebota: cada ruta se ofrece solo si este rol, en este perfil, la abre.
  const puede = (ruta: string) => puedeVerRuta(rol, ruta.split('?')[0], perfil);
  const filas = filasAtencion(d, principales, sufijo, 3, { puede, fallidos });
  const atajos = ATAJOS_RESUMEN.filter((a) => puede(a.href));
  const cob = coberturaDe(d);
  const ambito = `${tenantId}:${userId}`;

  return (
    <main className="rv-res">
      <EncabezadoPagina
        area={tenantNombre ? `Resumen · viendo como superadmin · ${tenantNombre}` : undefined}
        titulo="Resumen"
        apoyo={`${saludo()}, ${nombre ?? 'equipo'}. ${perfil ? 'Tus cinco agentes, de un vistazo.' : 'Tu flota, de un vistazo.'}`}
        acciones={<Chip>{fechaMx(diaMx)}</Chip>}
      />

      {!tenantExiste && <AvisoSinFlota tenantId={tenantId} />}

      {avisoFiscalPospuesto && (
        <Aviso tono="warn" acciones={puede('/dashboard/onboarding') ? <BotonEnlace tamano="sm" variante="secondary" href={`/dashboard/onboarding${sufijo}`}>Declararlo ahora</BotonEnlace> : undefined}>
          Tu perfil fiscal sigue sin declararse, así que el estímulo de peaje se muestra en $0 y no se acredita hasta que lo hagas.
        </Aviso>
      )}

      <FiltrosResumen rango={rango} fuentes={`Fuentes ${cob.ok} de ${cob.total}`} />

      <div className="rv-res__kpis"><TiraKpi items={itemsKpi(d, sufijo, puede)} etiqueta="Tu flota en Likida" /></div>

      <div className="rv-res__fila rv-res__fila--8-4">
        <TarjetaCierres d={d} />
        <Tarjeta titulo="Requiere tu atención" info="resumen.requiere_atencion" className="rv-res__atencion">
          <ListaAtencion filas={filas} senales={senales} ambito={ambito} soloLectura={soloLectura} sufijo={sufijo} />
        </Tarjeta>
      </div>

      <div className="rv-res__fila rv-res__fila--4-4-4">
        <TarjetaDiferencias d={d} />
        <TarjetaHizoSolo d={d} sufijo={sufijo} puede={puede} />
        <Tarjeta titulo="Siguiente mejor acción" info="resumen.siguiente_mejor_accion">
          <SiguienteAccion filas={filas} senales={senales} ambito={ambito} soloLectura={soloLectura} sufijo={sufijo} atajos={atajos} />
        </Tarjeta>
      </div>
    </main>
  );
}
