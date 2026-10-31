import { FileText } from 'lucide-react';
import { saludo, ahoraMs } from '@/lib/saludo';
import { fechaMx, hoyMx } from '@/lib/formato';
import { BotonEnlace, Chip, EncabezadoPagina, EstadoVacio } from '@/app/ui-v2/componentes';
import { TiraKpi, type ItemKpi } from '@/app/ui-v2/graficas';
import { anclaTour } from '@/app/ui-v2/movimiento/tour';
import { leerSenalesAsistente } from '@/lib/likida/asistente/senales';
import type { SenalesAsistente } from '@/lib/likida/asistente/pasos_cinco_agentes';
import { conPaso } from './puesta-en-marcha/con-paso';
import { TarjetaPuestaEnMarcha } from './puesta-en-marcha/tarjeta-marcha';
import { AvisoSinFlota } from './sin-flota';

// ═══════════════════════════════════════════════════════════════════════════
// RESUMEN v2 DE UNA CUENTA CON PERFIL `cinco_agentes` (rediseño, carril C.1).
//
// Mismo contenido de fondo que el Resumen de siempre (las cinco fichas, que se pasan ya armadas), con encabezado nuevo,
// el avance de la puesta en marcha, una tira de indicadores y el bloque «Hoy». Reglas: JAMÁS una cifra inventada ni una
// de ahorro; null = «—» con el sello «Sin dato» (no es 0); cada cifra es un conteo que la plataforma leyó de la flota.
// ═══════════════════════════════════════════════════════════════════════════

/** Los indicadores del Resumen: solo conteos leídos. `null` = no se pudo leer (se pinta «—»). Pura y probada. */
export function indicadoresResumen(s: SenalesAsistente): ItemKpi[] {
  const op = s.operadores;
  return [
    { etiqueta: 'Operadores activos', valor: op === null ? null : op.activos, tipo: 'observado', matiz: 1 },
    { etiqueta: 'Con correo cargado', valor: op === null ? null : op.conCorreo, nota: op && op.conCorreo !== null && op.activos > 0 ? `de ${op.activos}` : undefined, tipo: 'observado', matiz: 2 },
    { etiqueta: 'Unidades activas', valor: s.unidadesActivas, tipo: 'observado', matiz: 3 },
    { etiqueta: 'Supervisores con patio', valor: s.supervisores, tipo: 'observado', matiz: 4 },
  ];
}

export async function ResumenV2({
  tenantId, userId, tenantNombre, nombre, tenantExiste, sufijo, soloLectura, veAsistente, fichas,
}: {
  tenantId: string;
  userId: string;
  tenantNombre: string | null;
  nombre: string | null;
  tenantExiste: boolean;
  sufijo: string;
  soloLectura: boolean;
  /** ¿Este rol puede abrir /dashboard/puesta-en-marcha? Si no, no se lee ni se pinta nada del asistente (tarjeta, tira, «Hoy»). */
  veAsistente: boolean;
  /** Las tarjetas de los cinco agentes, ya armadas por `inicio-cinco-agentes.tsx` (no se duplica su lógica). */
  fichas: React.ReactNode;
}) {
  const diaMx = hoyMx(new Date(ahoraMs()));
  // Sin acceso a la pantalla del asistente (p. ej. el encargado) NO se calculan sus señales: ni tarjeta que rebota,
  // ni estado de conexiones en la carga del navegador.
  const senales = veAsistente ? await leerSenalesAsistente(tenantId) : null;
  const recibido = senales?.archivosRecibidos ?? null;

  return (
    <main className="rv-res">
      <EncabezadoPagina
        rotulo={tenantNombre ? `Resumen · viendo como superadmin · ${tenantNombre}` : 'Resumen'}
        titulo={`${saludo()}, ${nombre ?? 'equipo'}`}
        descripcion="Tus cinco agentes, de un vistazo."
        acciones={<Chip>{fechaMx(diaMx)}</Chip>}
      />

      {!tenantExiste && <AvisoSinFlota tenantId={tenantId} />}

      {senales && (
        <>
          <TarjetaPuestaEnMarcha senales={senales} ambito={`${tenantId}:${userId}`} sufijo={sufijo} soloLectura={soloLectura} />

          <TiraKpi items={indicadoresResumen(senales)} etiqueta="Tu flota en Likida" />
        </>
      )}

      {senales && <section className="rv-res__hoy" aria-labelledby="rv-res-hoy" {...anclaTour('resumen.hoy')}>
        <h2 id="rv-res-hoy" className="rv-res__sec">Hoy</h2>
        {recibido === null ? (
          <EstadoVacio escena="desglose-correo" compacto titulo="No pudimos revisar tus archivos ahora">
            Vuelve a cargar en un momento. Esto no dice que no hayas mandado nada.
          </EstadoVacio>
        ) : recibido > 0 ? (
          <div className="rv-res__hoy-ok">
            <FileText width={18} height={18} aria-hidden="true" />
            <p>Ya recibimos un archivo de muestra y lo estamos leyendo. En cuanto el correo esté probado, el desglose le llega al operador.</p>
          </div>
        ) : (
          <EstadoVacio
            escena="desglose-correo"
            titulo="Todavía no ha llegado ningún archivo"
            accion={<BotonEnlace variante="primary" href={conPaso('/dashboard/puesta-en-marcha', sufijo, 'tms')}>Entregar archivo de muestra</BotonEnlace>}
          >
            Manda un desglose de muestra de tu sistema de transporte y aquí verás cómo llega, a quién y qué pasó.
          </EstadoVacio>
        )}
      </section>}

      <section aria-labelledby="rv-res-ag">
        <h2 id="rv-res-ag" className="rv-res__sec">Agentes</h2>
        <div className="rv-res__agentes">{fichas}</div>
      </section>
    </main>
  );
}
