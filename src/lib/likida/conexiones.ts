import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from './presupuesto';
import { getFiscalDeFlota } from './facturacion/flota_fiscal';
import { portalesVivos, PORTALES_CONOCIDOS } from './facturacion/adaptadores/registro';
import { modoEfectivo, mandatoFiscalAceptado } from './facturacion/modo';
import { correoConfigurado } from '@/lib/correo/enviar';

// ═══════════════════════════════════════════════════════════════════════════
// CONEXIONES (F7 del plan — el chasis de Handle): qué tiene conectado la
// flota y qué le falta, con estado MEDIDO — nunca un semáforo decorativo.
// La regla de la pantalla: cada renglón dice de dónde salió su verdad, y lo
// que no se puede medir se declara 'no_medible' en vez de pintarse verde.
// ═══════════════════════════════════════════════════════════════════════════

export interface Conector {
  id: 'whatsapp' | 'correo' | 'fiscal' | 'portales' | 'rastreo' | 'timbrado';
  nombre: string;
  estado: 'listo' | 'incompleto' | 'sin_configurar' | 'ensayo';
  /** La verdad medida, en una línea — con su fuente. */
  detalle: string;
  /** Lo que falta, en palabras de persona (solo cuando aplica). */
  falta: string[];
}

export async function getConexiones(tenantId: string): Promise<Conector[]> {
  const [fiscal, rastreo] = await Promise.all([
    getFiscalDeFlota(tenantId).catch(() => null),
    acotada(supabaseAdmin()
      .from('rastreo_credencial')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId), 'conexiones.rastreo')
      .then(({ count, error }) => (error ? null : count ?? 0)) as Promise<number | null>,
  ]);

  const conectores: Conector[] = [];

  // WhatsApp — el canal es del SISTEMA (un número de Likida por ahora), así
  // que su configuración se mide en el servidor; la salud POR FLOTA la dan
  // sus propios mensajes cuando los haya.
  const waConfigurado = Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
  conectores.push({
    id: 'whatsapp',
    nombre: 'WhatsApp (choferes y oficina)',
    estado: waConfigurado ? 'listo' : 'sin_configurar',
    detalle: waConfigurado
      ? 'Canal configurado en el sistema — comprobantes, hitos y despacho entran por aquí.'
      : 'El canal de WhatsApp no está configurado en este entorno.',
    falta: [],
  });

  // Correo saliente (Resend, 14-ago-2026). Igual que WhatsApp, el canal es del
  // SISTEMA —un dominio de Likida, `mail.likida.ai`— y por eso se mide en el
  // servidor y no por flota.
  //
  // Se comprueban las DOS variables, no solo la llave: con `RESEND_API_KEY`
  // pero sin dominio, `enviarCorreo` no arma el remitente y devuelve
  // `sin_configurar` — el renglón diría "listo" mientras ningún aviso sale.
  const correoListo = correoConfigurado();
  conectores.push({
    id: 'correo',
    nombre: 'Correo de avisos',
    estado: correoListo ? 'listo' : 'sin_configurar',
    detalle: correoListo
      ? `Los avisos salen de avisos@${process.env.RESEND_EMAIL_DOMAIN} — dominio verificado con SPF y DKIM.`
      : 'Sin configurar: los avisos por correo no salen. WhatsApp sigue funcionando.',
    // Lo que este renglón NO puede afirmar: que el correo LLEGUE. Un dominio
    // verificado y una llave válida solo prueban que se puede mandar; que no
    // caiga en spam depende de la reputación, y eso se mide con los eventos de
    // entrega, no con dos variables de entorno.
    falta: correoListo ? [] : ['conectar Resend desde el marketplace de Vercel'],
  });

  // Datos fiscales — lo que getFiscalDeFlota MIDE (es lo mismo que usa el
  // agente de facturas para llenar portales).
  conectores.push({
    id: 'fiscal',
    nombre: 'Datos fiscales de la flota',
    estado: fiscal === null ? 'sin_configurar' : fiscal.flota ? 'listo' : 'incompleto',
    detalle: fiscal === null
      ? 'No se pudieron leer ahora mismo.'
      : fiscal.flota
        ? 'Completos: con esto el agente llena portales de facturación.'
        : 'Faltan datos para facturar en portales.',
    falta: fiscal?.falta ?? [],
  });

  // Portales de facturación — el catálogo que el agente sabe operar.
  const vivos = portalesVivos(tenantId).length;
  conectores.push({
    id: 'portales',
    nombre: 'Portales de facturación',
    estado: vivos > 0 ? 'listo' : 'sin_configurar',
    detalle: `${vivos} portales operables hoy para esta flota, de ${PORTALES_CONOCIDOS.length} que el agente conoce.`,
    falta: [],
  });

  // Rastreo GPS — la tabla existe desde la 0050 y HOY está vacía para todas
  // las flotas: el mapa lo declara. Conectarlo es exactamente este renglón.
  conectores.push({
    id: 'rastreo',
    nombre: 'Rastreo GPS (credenciales del proveedor)',
    estado: rastreo === null ? 'sin_configurar' : rastreo > 0 ? 'listo' : 'sin_configurar',
    detalle: rastreo === null
      ? 'No se pudo leer el estado ahora mismo.'
      : rastreo > 0
        ? `${rastreo} credencial${rastreo === 1 ? '' : 'es'} de rastreo conectada${rastreo === 1 ? '' : 's'}.`
        : 'Sin conectar — el mapa pinta trayectos ilustrativos; con credenciales pinta posiciones reales.',
    falta: [],
  });

  // Timbrado — el candado legal es una DECISIÓN, no una falla: se dice así.
  const emite = modoEfectivo(
    process.env.FACTURACION_MODO === 'emitir' ? 'emitir' : 'ensayo',
    mandatoFiscalAceptado(),
  ) === 'emitir';
  conectores.push({
    id: 'timbrado',
    nombre: 'Emisión de CFDI (timbrado)',
    estado: emite ? 'listo' : 'ensayo',
    detalle: emite
      ? 'Encendido: el agente emite en portales de verdad.'
      : 'En ensayo por candado legal — decisión de negocio: se enciende al cerrar el primer cliente (runbook en docs/encender-emision.md).',
    falta: [],
  });

  return conectores;
}
