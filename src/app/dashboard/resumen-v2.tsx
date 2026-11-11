import { saludo, ahoraMs } from '@/lib/saludo';
import { fechaMx, hoyMx } from '@/lib/formato';
import { Aviso, BotonEnlace, Chip, FilaTarjetas, Tarjeta } from '@/app/ui-v2/componentes';
import { EsqueletoPortada } from '@/app/ui-v2/esqueletos';
import { leerSenalesAsistente } from '@/lib/likida/asistente/senales';
import type { AgenteInsight, Insight } from '@/lib/likida/insights/tipos';
import { puedeVerRuta, type PerfilTenant } from '@/lib/auth/visibilidad';
import { AvisoSinFlota } from './sin-flota';
import { ATAJOS_RESUMEN, coberturaDe, filasAtencion, leerDatosResumen, type RangoResumen } from './resumen-datos';
import { FiltrosResumen, ListaAtencion, SiguienteAccion } from './resumen-cliente';
import { itemsKpi, TarjetaCierres, TarjetaDiferencias, TarjetaHizoSolo } from './resumen-tarjetas';
import { getT } from '@/lib/i18n/servidor';

// ═══════════════════════════════════════════════════════════════════════════
// RESUMEN v2 DEL DUEÑO, página CANÓNICA del contrato visual (MarcoPagina + FilaTarjetas + TiraCifras; 0 style=, 0 .card):
// encabezado → barra de periodo (40 px) → tira de 4 KPI → fila 8+4
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
  const { t, idioma } = await getT('resto');
  const diaMx = hoyMx(new Date(ahoraMs()));
  const [d, senales] = await Promise.all([
    leerDatosResumen(tenantId, rango, veDinero),
    veAsistente ? leerSenalesAsistente(tenantId) : Promise.resolve(null),
  ]);
  // Ningún enlace de la pantalla rebota: cada ruta se ofrece solo si este rol, en este perfil, la abre.
  const puede = (ruta: string) => puedeVerRuta(rol, ruta.split('?')[0], perfil);
  const filas = filasAtencion(d, principales, sufijo, 3, { puede, fallidos }, t);
  const atajos = ATAJOS_RESUMEN.filter((a) => puede(a.href));
  const cob = coberturaDe(d);
  const ambito = `${tenantId}:${userId}`;

  return (
    <EsqueletoPortada
      area={tenantNombre ? `Resumen · viendo como superadmin · ${tenantNombre}` : undefined}
      titulo={t('op.resumen')}
      apoyo={`${saludo()}, ${nombre ?? 'equipo'}. ${perfil ? t('op.tus_cinco_agentes_de_un_vistazo_3') : t('op.tu_flota_de_un_vistazo')}`}
      acciones={<Chip>{fechaMx(diaMx, idioma)}</Chip>}
      filtros={<FiltrosResumen rango={rango} fuentes={`Fuentes ${cob.ok} de ${cob.total}`} />}
      avisos={(
        <>
          {!tenantExiste && <AvisoSinFlota tenantId={tenantId} />}
          {avisoFiscalPospuesto && (
            <Aviso tono="warn" acciones={puede('/dashboard/onboarding') ? <BotonEnlace tamano="sm" variante="secondary" href={`/dashboard/onboarding${sufijo}`}>{t('op.declararlo_ahora')}</BotonEnlace> : undefined}>{t('op.tu_perfil_fiscal_sigue_sin_declararse')}</Aviso>
          )}
        </>
      )}
      cifras={itemsKpi(d, sufijo, puede, t)}
      etiquetaCifras={t('op.tu_flota_en_likida')}
    >
      <FilaTarjetas variante="8-4">
        <TarjetaCierres t={t} d={d} />
        <Tarjeta titulo={t('op.requiere_tu_atencion')} info="resumen.requiere_atencion">
          <ListaAtencion filas={filas} senales={senales} ambito={ambito} soloLectura={soloLectura} sufijo={sufijo} />
        </Tarjeta>
      </FilaTarjetas>

      <FilaTarjetas variante="4-4-4" llena>
        <TarjetaDiferencias t={t} d={d} />
        <TarjetaHizoSolo t={t} d={d} sufijo={sufijo} puede={puede} />
        <Tarjeta titulo={t('op.siguiente_mejor_accion')} info="resumen.siguiente_mejor_accion">
          <SiguienteAccion filas={filas} senales={senales} ambito={ambito} soloLectura={soloLectura} sufijo={sufijo} atajos={atajos} />
        </Tarjeta>
      </FilaTarjetas>
    </EsqueletoPortada>
  );
}
