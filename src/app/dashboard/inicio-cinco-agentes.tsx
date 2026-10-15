import Link from 'next/link';
import { LayoutGrid, Route, Scale, ScrollText, UsersRound, MessagesSquare, Plus, Users, Truck, Container } from 'lucide-react';
import { saludo, ahoraMs } from '@/lib/saludo';
import { fechaMx, fechaHoraMx, hoyMx } from '@/lib/formato';
import { ultimasCorridas, duracionLegible, type AgenteConCorridas, type CorridaRegistrada } from '@/lib/likida/agentes/corridas';
import { BarraPagina, ChipFecha, HeroSaludo, TituloSeccion } from './resumen-visual';
import { AvisoSinFlota } from './sin-flota';
import { Bloque, EsqTabla } from './bloque';
import { moduloProximamenteDeRuta, rutaProximamente } from '@/lib/auth/visibilidad';

// ═══════════════════════════════════════════════════════════════════════════
// EL RESUMEN DE UNA FLOTA CON PERFIL `cinco_agentes` (mig. 0770).
//
// Reemplaza al Resumen de siempre SOLO bajo el perfil. El de siempre trae KPIs
// fiscales y de dinero, el chat, la suscripción con planes y precios, y las
// alertas de módulos que el perfil deja en stand-by: nada de eso se enseña
// aquí. Lo que hay son los cinco agentes, cada uno con su enlace y con el
// ÚNICO indicador que ya existe y es verdad para todos: cuándo corrió por
// última vez y cómo terminó (`agente_corrida`). Sin corrida registrada se dice
// «sin corridas registradas», nunca un cero con cara de medición. Los
// indicadores de negocio por agente (qué pasó · qué significa · qué hacer) los
// pule cada agente en su propia pantalla, no este tablero.
//
// Cero pesos en esta pantalla (el Resumen es de `operacion`).
// ═══════════════════════════════════════════════════════════════════════════

interface FichaAgente {
  clave: string;
  nombre: string;
  descripcion: string;
  href: string;
  Icono: typeof Route;
  /** Qué agente de `agente_corrida` lo representa; `null` si no registra corridas. */
  corridas: AgenteConCorridas | null;
}

/** Los cinco, en el orden en que los nombra el producto. Una sola fuente para el Resumen. */
export const FICHAS_CINCO_AGENTES: readonly FichaAgente[] = [
  { clave: 'liquidacion', nombre: 'Liquidación automática', href: '/dashboard/agentes/liquidacion', Icono: Route, corridas: 'liquidacion',
    descripcion: 'Arma la liquidación de cada viaje y marca lo que no cuadra.' },
  { clave: 'peajes', nombre: 'Conciliación de peajes', href: '/dashboard/agentes/peajes', Icono: Scale, corridas: 'peajes',
    descripcion: 'Cruza el estado de cuenta de casetas contra los viajes.' },
  { clave: 'carta_porte', nombre: 'Carta Porte en automático', href: '/dashboard/agentes/carta-porte', Icono: ScrollText, corridas: 'carta_porte',
    descripcion: 'Prepara el borrador del complemento y pide lo que falta.' },
  { clave: 'vigia', nombre: 'Servicio al cliente', href: '/dashboard/agentes/vigia', Icono: UsersRound, corridas: null,
    descripcion: 'Atiende a los clientes de la flota; una persona aprueba.' },
  { clave: 'conductor', nombre: 'Comunicación con operadores', href: '/dashboard/agentes/conductores', Icono: MessagesSquare, corridas: 'conductores',
    descripcion: 'Sigue los hitos del viaje y avisa cuando algo no se reporta.' },
];

const ICONO_BARRA = { width: 15, height: 15, strokeWidth: 1.75, style: { color: 'var(--muted)' } } as const;

/** Resuelve a `null` ante cualquier fallo: la tarjeta lo confiesa, nunca lo vuelve un cero. */
async function ultima(tenantId: string, agente: AgenteConCorridas): Promise<CorridaRegistrada | null | undefined> {
  try {
    const l = await ultimasCorridas(tenantId, agente, 1);
    return l[0];
  } catch {
    return null;
  }
}

const ETIQUETA_ESTADO: Record<string, string> = { ok: 'terminó bien', parcial: 'terminó con pendientes', fallo: 'falló' };

function Indicador({ corrida }: { corrida: CorridaRegistrada | null | undefined }) {
  if (corrida === null) {
    return <p className="text-[12px]" style={{ color: 'var(--muted)' }}>No se pudo leer la última corrida.</p>;
  }
  if (corrida === undefined) {
    return <p className="text-[12px]" style={{ color: 'var(--muted)' }}>Sin corridas registradas todavía.</p>;
  }
  const dur = duracionLegible(corrida.duracionMs);
  return (
    <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
      Última corrida: {fechaHoraMx(corrida.inicio)} · {ETIQUETA_ESTADO[corrida.estado] ?? corrida.estado}
      {dur ? ` · ${dur}` : ''}
    </p>
  );
}

async function TarjetaAgente({ ficha, tenantId, sufijo }: { ficha: FichaAgente; tenantId: string; sufijo: string }) {
  // «Próximamente» (fase 1): la ficha se ve pero no consulta nada de la flota y su enlace va al anuncio, no a la función.
  const proximamente = moduloProximamenteDeRuta('cinco_agentes', ficha.href);
  const corrida = ficha.corridas && !proximamente ? await ultima(tenantId, ficha.corridas) : undefined;
  return (
    <Link href={`${proximamente ? rutaProximamente(proximamente) : ficha.href}${sufijo}`} className="card p-4 block transition-opacity hover:opacity-85" data-agente={ficha.clave}>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--canvas)', border: '1px solid var(--line)' }}>
          <ficha.Icono width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />
        </div>
        <div className="min-w-0">
          <h3 className="text-[14px] font-medium">
            {ficha.nombre}
            {proximamente && (
              <span className="ml-2 align-middle text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: 'var(--canvas)', color: 'var(--muted)' }}>Próximamente</span>
            )}
          </h3>
          <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--ink2)' }}>{ficha.descripcion}</p>
          <div className="mt-2">
            {proximamente ? (
              <p className="text-[12px]" style={{ color: 'var(--muted)' }}>Todavía no está activo en tu cuenta.</p>
            ) : ficha.corridas ? <Indicador corrida={corrida} /> : (
              <p className="text-[12px]" style={{ color: 'var(--muted)' }}>Abre su tablero para ver y aprobar las respuestas.</p>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

const ATAJOS: ReadonlyArray<{ href: string; nombre: string; Icono: typeof Route }> = [
  { href: '/dashboard/despacho', nombre: 'Nuevo viaje', Icono: Plus },
  { href: '/dashboard/viajes', nombre: 'Viajes', Icono: Truck },
  { href: '/dashboard/operadores', nombre: 'Operadores', Icono: Users },
  { href: '/dashboard/unidades', nombre: 'Unidades', Icono: Container },
];

export async function InicioCincoAgentes({
  tenantId, tenantNombre, nombre, tenantExiste = true, sufijo = '',
}: {
  tenantId: string;
  tenantNombre: string | null;
  nombre: string | null;
  tenantExiste?: boolean;
  sufijo?: string;
}) {
  const diaMx = hoyMx(new Date(ahoraMs()));
  return (
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<LayoutGrid {...ICONO_BARRA} />}
          titulo="Resumen"
          derecha={tenantNombre && (
            <span className="inline-block text-[11px] px-2 py-0.5 rounded-full font-medium shrink-0" style={{ color: 'var(--accent-fg)', background: 'var(--accent)' }}>
              viendo como superadmin · {tenantNombre}
            </span>
          )}
        />
        <HeroSaludo
          saludo={saludo()} nombre={nombre ?? 'equipo'}
          tagline="Tus cinco agentes, de un vistazo"
          derecha={<div className="shrink-0 pt-1"><ChipFecha>{fechaMx(diaMx)}</ChipFecha></div>}
        />
        <div className="px-5 pb-5 flex-1">
          {!tenantExiste && <div className="mt-3"><AvisoSinFlota tenantId={tenantId} /></div>}

          <div className="mt-3">
            <TituloSeccion>Agentes</TituloSeccion>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-2">
              {FICHAS_CINCO_AGENTES.map((f) => (
                <Bloque key={f.clave} mensaje={`No se pudo leer ${f.nombre}.`} esqueleto={<EsqTabla filas={2} titulo={false} />}>
                  <TarjetaAgente ficha={f} tenantId={tenantId} sufijo={sufijo} />
                </Bloque>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <TituloSeccion>Para operarlos</TituloSeccion>
            <div className="flex flex-wrap gap-2 mt-2">
              {ATAJOS.map((a) => (
                <Link key={a.href} href={`${a.href}${sufijo}`}
                  className="hairline h-8 px-3 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 transition-opacity hover:opacity-85"
                  style={{ background: 'var(--surface)' }}>
                  <a.Icono width={15} height={15} strokeWidth={1.75} /> {a.nombre}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
