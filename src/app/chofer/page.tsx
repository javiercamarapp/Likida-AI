import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { ChevronRight } from 'lucide-react';
import { requireOperador } from '@/lib/auth/guard';
import { viajeEnCurso, unidadDelViaje, aceptarViaje } from '@/lib/cuadra/chofer';
import { Titulo, Pendiente, ViajeDeHoy, SinViaje, ViajeAceptado, TOQUE } from './vista';
import BotonAceptar, { type EstadoAceptar } from './aceptar';

export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════════════════
// HOY — el viaje que trae, y el botón para aceptarlo si todavía no lo hizo.
//
// Es la primera pantalla porque es la única pregunta que un chofer se hace
// antes de arrancar: "¿cuál es mi viaje?". Todo lo demás —el saldo, los
// tickets, el historial— se consulta a media ruta o al final.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Deja constancia de que aceptó.
 *
 * EL `viajeId` NO VIENE DEL FORMULARIO. Se vuelve a resolver desde la sesión,
 * así que no hay campo oculto que cambiar: aunque `aceptarViaje` ya filtra por
 * `operador_id`, lo que no viaja por el navegador no se puede manipular.
 */
async function aceptar(): Promise<EstadoAceptar> {
  'use server';
  const s = await requireOperador();
  if (!s.tenantId) return { error: 'Tu cuenta todavía no está ligada a una flota. Avísale a tu oficina.' };

  const viaje = await viajeEnCurso(s.tenantId, s.operadorId);
  if (!viaje) return { error: 'Ya no traes un viaje abierto. Vuelve a cargar la pantalla.' };

  const r = await aceptarViaje(s.tenantId, s.operadorId, viaje.id);
  revalidatePath('/chofer');

  switch (r) {
    case 'aceptado':
      return { ok: 'Listo, quedó registrado que aceptaste el viaje.' };
    case 'ya_estaba':
      return { ok: 'Este viaje ya estaba aceptado.' };
    case 'no_es_tuyo':
      return { error: 'Ese viaje ya no aparece a tu nombre. Habla con tu oficina.' };
    default:
      // NO se dice "listo" cuando no se pudo escribir: el chofer se iría
      // creyendo que su jefe ya lo sabe, y a las 5 h le van a hablar.
      return { error: 'No se pudo registrar ahorita. Vuelve a intentar en un momento.' };
  }
}

export default async function Hoy() {
  const s = await requireOperador();

  // `app_user.tenant_id` es nullable: una cuenta de chofer creada sin flota
  // pasaría la puerta y todas las consultas saldrían vacías — que en pantalla
  // se lee como "no tienes viajes", que es falso. Se dice qué falta.
  if (!s.tenantId) {
    return (
      <>
        <Titulo>Hoy</Titulo>
        <Pendiente>
          Tu cuenta todavía no está ligada a una flota, así que no se pueden
          mostrar tus viajes. Pídele a tu oficina que complete tu alta.
        </Pendiente>
      </>
    );
  }

  const viaje = await viajeEnCurso(s.tenantId, s.operadorId);
  const unidad = viaje ? await unidadDelViaje(s.tenantId, viaje) : null;

  return (
    <>
      <Titulo>Hoy</Titulo>

      {!viaje ? (
        <SinViaje />
      ) : (
        <>
          <ViajeDeHoy viaje={viaje} unidad={unidad} />

          {viaje.aceptadoEn
            ? <ViajeAceptado cuando={viaje.aceptadoEn} />
            : <BotonAceptar accion={aceptar} />}

          <Link
            href="/chofer/liquidacion"
            className="card px-4 flex items-center justify-between gap-3 text-base font-medium"
            style={{ minHeight: TOQUE.principal }}
          >
            Ver cuánto llevo comprobado
            <ChevronRight width={20} height={20} strokeWidth={2} style={{ color: 'var(--muted)' }} />
          </Link>

          <p className="text-base leading-relaxed" style={{ color: 'var(--muted)' }}>
            Los comprobantes se siguen mandando por WhatsApp: aquí solo los
            consultas.
          </p>
        </>
      )}
    </>
  );
}
