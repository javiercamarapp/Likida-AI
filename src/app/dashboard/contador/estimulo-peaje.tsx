import { revalidatePath } from 'next/cache';
import { Landmark } from 'lucide-react';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import {
  calificaEstimuloPeaje,
  preguntaPendienteEstimuloPeaje,
  umbralPeajeDeclarado,
} from '@/lib/likida/perfil/preguntas';
import { getPerfilCrudo, guardarDeclaracionEstimuloPeaje } from '@/lib/likida/repo';
import { mensajeParaPantalla } from '@/lib/likida/administracion';
import { FormaConAviso, Selector, type ResultadoAccion } from '../../admin/ui/forma';

/**
 * FASE 3 — la pregunta que cierra el hueco H6 (LIF 2026 art. 20-A).
 *
 * Sin este formulario el candado de `calificaEstimuloPeaje` nunca se gira:
 * `elegiblePeaje` queda `undefined` y el motor deja el estímulo en $0
 * (fail-closed). Vive en el panel del contador porque
 * el dato es fiscal y esa ruta es `dinero` (contador, dueño, superadmin).
 *
 * La pregunta es binaria a propósito: pedir un monto exacto invita a
 * inventar una cifra. El umbral legal es "menores a $300 millones".
 */
export async function EstimuloPeaje({
  searchParams,
  tenantExiste,
}: {
  searchParams: { vista?: string; tenant?: string; rol?: string };
  tenantExiste: boolean;
}) {
  if (!tenantExiste) return null;

  const { tenantId } = await resolverTenantEfectivo('/dashboard/contador', searchParams);
  let perfil: unknown = {};
  try {
    perfil = await getPerfilCrudo(tenantId);
  } catch {
    perfil = {};
  }
  const { elegible } = calificaEstimuloPeaje(perfil);
  const pendiente = preguntaPendienteEstimuloPeaje(perfil);
  const declarado = umbralPeajeDeclarado(perfil);
  const umbralInicial = declarado.ingresosMenoresA300M === null ? '' : declarado.ingresosMenoresA300M ? 'menor' : 'mayor';
  const parteInicial = declarado.parteRelacionada === null ? '' : declarado.parteRelacionada ? 'si' : 'no';

  async function accion(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await resolverTenantEfectivo('/dashboard/contador', searchParams);
    if (!puedeVerRuta(s.rol, '/dashboard/contador')) {
      return { error: 'Tu rol no puede declarar la elegibilidad del estímulo de peaje.' };
    }
    const ingresos = String(fd.get('ingresos') ?? '');
    const parte = String(fd.get('parte') ?? '');
    if (ingresos !== 'menor' && ingresos !== 'mayor') {
      return { error: 'Falta decir si los ingresos del último ejercicio fueron menores a $300 millones.' };
    }
    if (parte !== 'si' && parte !== 'no') {
      return { error: 'Falta decir si la flota es parte relacionada (LISR art. 179).' };
    }
    try {
      await guardarDeclaracionEstimuloPeaje(
        s.tenantId,
        ingresos === 'menor',
        parte === 'si',
        s.userId,
      );
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'guardar la declaración') };
    }
    revalidatePath('/dashboard/contador');
    const califica = ingresos === 'menor' && parte === 'no';
    return {
      ok: califica
        ? 'Declaración guardada. El 50% de peaje se acreditará en el próximo cuadre SI además se cumplen dedicación exclusiva y Red Nacional (Likida no las verifica).'
        : 'Declaración guardada. Esta flota no califica: el estímulo de peaje queda en $0 a partir del próximo cuadre.',
    };
  }

  return (
    <section
      className="mt-3 rounded-2xl px-5 py-4 flex flex-col gap-3 hairline"
      style={{ background: 'var(--surface)' }}
    >
      <div className="flex items-start gap-2.5">
        <Landmark width={16} height={16} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: 'var(--muted)' }} />
        <div className="min-w-0">
          <p className="text-sm font-medium">Estímulo de peaje (LIF 2026 art. 20-A)</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            {pendiente
              ? 'Sin esta declaración el estímulo queda en $0. Contéstalo antes del primer cierre; una flota grande o una parte relacionada no puede acreditarlo.'
              : elegible
                ? 'Declarado: ingresos menores a $300M y no parte relacionada. El motor acredita el 50% en casetas de pago electrónico. Dedicación exclusiva y Red Nacional siguen siendo responsabilidad de la flota.'
                : 'Declarado: esta flota no califica (ingresos de $300M o más, o parte relacionada). El estímulo de peaje queda en $0.'}
          </p>
        </div>
      </div>
      <FormaConAviso accion={accion} boton={pendiente ? 'Declarar' : 'Corregir declaración'} columnas="md:grid-cols-2">
        <Selector
          nombre="ingresos"
          etiqueta="Ingresos totales anuales del último ejercicio"
          requerido
          valorInicial={umbralInicial}
          opciones={[
            { valor: '', texto: 'Elige una' },
            { valor: 'menor', texto: 'Menores a $300 millones' },
            { valor: 'mayor', texto: '$300 millones o más' },
          ]}
          ayuda="El umbral legal es estricto: $300 millones exactos ya no califican."
        />
        <Selector
          nombre="parte"
          etiqueta="¿Es parte relacionada de otra empresa? (LISR art. 179)"
          requerido
          valorInicial={parteInicial}
          opciones={[
            { valor: '', texto: 'Elige una' },
            { valor: 'no', texto: 'No' },
            { valor: 'si', texto: 'Sí' },
          ]}
        />
      </FormaConAviso>
    </section>
  );
}
