// ═══════════════════════════════════════════════════════════════════════════
// EL CONTACTO DE LA CALCULADORA → prospecto con fuente 'landing'.
//
// La única ruta pública de escritura del marketing. Candados, en orden:
//  1. Límite de tasa por IP (5 / 10 min), antes de leer el stream.
//  2. Tope de cuerpo (10 KB) durante la lectura del formulario.
//  3. Honeypot (`sitioWeb`): si viene lleno, se contesta 200 SIN escribir —
//     avisarle al bot que lo cachamos es enseñarle a esquivarlo. Se deja log.
//  4. La validación REAL es la del pipeline (`validarProspecto`): misma
//     regla, mismos mensajes — no una segunda validación que divergiría.
//  5. El correo O el WhatsApp: sin al menos uno no hay a quién mandarle su
//     copia, que es exactamente lo que el visitante pidió.
//
// Lo que el visitante calculó viaja en `notas` (el descubrimiento del demo
// arranca con datos en lugar de con preguntas — blueprint del lead magnet), y
// el aviso a Javier sale el mismo día vía `alertarOperador` (el detalle pasa
// por `redactarTexto` antes de viajar, como todo lo del operador).
// ═══════════════════════════════════════════════════════════════════════════
import { NextResponse } from 'next/server';
import { rateLimit, clientIp } from '@/lib/ratelimit';
import { leerTextoAcotado } from '@/lib/http/cuerpo_acotado';
import { crearProspecto, validarProspecto } from '@/lib/likida/vendedores';
import { DatoInvalido, textoDeDato } from '@/lib/likida/errores';
import { alertarOperador } from '@/lib/observability/alerta';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { atribucionDe, canalDe } from '@/lib/marketing/atribucion';
import { getT } from '@/lib/i18n/servidor';

/** El traductor, pedido SOLO cuando hay un texto que decir. */
const T = () => getT('mensajes');

export const dynamic = 'force-dynamic';

interface Cuerpo {
  nombre?: unknown; empresa?: unknown; correo?: unknown; telefono?: unknown;
  sitioWeb?: unknown;
  /** utm_*, click id, referrer y ruta que el cliente leyó de la URL (F16). Se filtra a las claves conocidas. */
  atribucion?: unknown;
  cifras?: {
    litrosDieselMes?: unknown; gastoDieselMesMxn?: unknown;
    gastoCasetasMesMxn?: unknown; unidades?: unknown;
  };
}

const s = (v: unknown): string => (typeof v === 'string' ? v : '');
const n = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;

export async function POST(req: Request) {
  if (!(await rateLimit(`marketing-prospecto:${clientIp(req)}`, 5, 10 * 60_000))) {
    return NextResponse.json({ error: (await T()).t('mk.intentos') }, { status: 429 });
  }
  const lectura = await leerTextoAcotado(req, 10_000);
  if (!lectura.ok) {
    return NextResponse.json(
      { error: (await T()).t(lectura.motivo === 'demasiado_grande' ? 'mk.cuerpo_grande' : 'mk.cuerpo_invalido') },
      { status: lectura.motivo === 'demasiado_grande' ? 413 : 400 },
    );
  }

  let c: Cuerpo;
  try {
    c = JSON.parse(lectura.texto) as Cuerpo;
  } catch {
    return NextResponse.json({ error: (await T()).t('mk.cuerpo_invalido') }, { status: 400 });
  }

  // Honeypot: 200 sin escribir. El log queda para medir el ruido.
  if (s(c.sitioWeb).trim() !== '') {
    logger.info('marketing.honeypot', { pagina: 'calculadora' });
    return NextResponse.json({ ok: true });
  }

  const correo = s(c.correo).trim();
  const telefono = s(c.telefono).trim();
  if (correo === '' && telefono === '') {
    return NextResponse.json(
      { error: (await T()).t('mk.sin_contacto') },
      { status: 400 },
    );
  }

  // Las cifras que el visitante YA calculó — van a notas, citables, sin
  // inventar las ausentes (null se dice "sin dato", jamás 0).
  const litros = n(c.cifras?.litrosDieselMes);
  const gastoDiesel = n(c.cifras?.gastoDieselMesMxn);
  const casetas = n(c.cifras?.gastoCasetasMesMxn);
  const unidades = n(c.cifras?.unidades);
  const nota = [
    'Llegó por la calculadora pública.',
    `Litros diésel/mes: ${litros ?? 'sin dato'}${litros === null && gastoDiesel !== null ? ` (dio gasto: $${gastoDiesel}/mes)` : ''}.`,
    `Casetas/mes: ${casetas === null ? 'sin dato' : `$${casetas}`}.`,
    `Unidades: ${unidades ?? 'sin dato'}.`,
  ].join(' ');

  try {
    const valido = validarProspecto({
      empresa: s(c.empresa),
      contactoNombre: s(c.nombre),
      telefono,
      correo,
      ciudad: '',
      vacante: '',
      notas: nota,
      vendedorId: '',
    });
    // F16: el canal sale de la atribución (antes iba fijo 'landing' y un lead de anuncio contaba como orgánico).
    const atr = atribucionDe(c.atribucion);
    const id = await crearProspecto(valido, canalDe(atr), atr);

    // La conversión del embudo — mejor esfuerzo: la analítica jamás tumba
    // la captura que sí importa.
    const { error: errEvento } = await supabaseAdmin()
      .from('sitio_evento')
      .insert({ pagina: 'calculadora', evento: 'conversion' });
    if (errEvento) logger.warn('marketing.evento_fallo', { error: errEvento.message });

    // El aviso del mismo día (blueprint: "notificación a Javier el mismo
    // día"). El umbral de calificación automática quedó como DECISIÓN DE
    // JAVIER en el blueprint — por eso aquí se avisa SIEMPRE, sin umbral.
    await alertarOperador('prospecto.landing', {
      prospectoId: id,
      unidades: unidades ?? 'sin dato',
      litrosMes: litros ?? 'sin dato',
      casetasMes: casetas ?? 'sin dato',
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof DatoInvalido) {
      const tr = await T();
      return NextResponse.json({ error: textoDeDato(e, tr.idioma) }, { status: 400 });
    }
    const error = e instanceof Error ? e.message : String(e);
    logger.error('marketing.prospecto_fallo', { error });
    return NextResponse.json(
      { error: (await T()).t('mk.falla') },
      { status: 500 },
    );
  }
}
