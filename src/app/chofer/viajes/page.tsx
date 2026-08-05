import { requireOperador } from '@/lib/auth/guard';
import { misViajes, TOPE_HISTORIAL } from '@/lib/cuadra/chofer';
import { Titulo, Pendiente, ListaViajes } from '../vista';

export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════════════════
// MIS VIAJES — el historial, con el papel de cada uno.
//
// El PDF que se enlaza es el ejemplar que ya existe en Storage. La liga se
// firma con TTL corto (`chofer.ts`), NO se pasa por `/api/export/pdf/[id]`:
// esa ruta autoriza con "hay sesión en este tenant" y sirve cualquier
// liquidación de la flota a cualquiera que la pida, chofer incluido.
//
// La diferencia se enseña como SALDO ("a favor de la empresa" / "a favor del
// operador"), nunca como "debes": que exista diferencia no autoriza un
// descuento de nómina —el art. 110 fr. I de la LFT exige acuerdo con el
// trabajador, ver `laboral/pagadero.ts`— y esta pantalla no es quien lo decide.
// ═══════════════════════════════════════════════════════════════════════════

export default async function MisViajes() {
  const s = await requireOperador();

  if (!s.tenantId) {
    return (
      <>
        <Titulo>Mis viajes</Titulo>
        <Pendiente>
          Tu cuenta todavía no está ligada a una flota, así que no se pueden
          mostrar tus viajes. Pídele a tu oficina que complete tu alta.
        </Pendiente>
      </>
    );
  }

  const viajes = await misViajes(s.tenantId, s.operadorId);

  return (
    <>
      <Titulo>Mis viajes</Titulo>

      {viajes.length === 0 ? (
        <Pendiente>
          Todavía no tienes viajes registrados a tu nombre. Aparecen aquí en
          cuanto tu oficina te asigne el primero.
        </Pendiente>
      ) : (
        <>
          <ListaViajes viajes={viajes} />
          {/* Solo cuando la lista TOPA. Ponerlo siempre convertiría "tienes 3
              viajes" en "se muestran 3", que se lee como que hay más. */}
          {viajes.length === TOPE_HISTORIAL && (
            <p className="text-base text-center" style={{ color: 'var(--faint)' }}>
              Se muestran tus {TOPE_HISTORIAL} viajes más recientes.
            </p>
          )}
        </>
      )}
    </>
  );
}
