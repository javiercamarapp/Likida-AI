import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { getResumenNegocio } from '@/lib/admin/negocio';
import { logger } from '@/lib/logger';
import { usd, numero } from '@/lib/formato';
import { sentryActivo } from '@/lib/observability/sentry';
import { correoConfigurado } from '@/lib/correo/enviar';
import { hookDeCorreoConfigurado } from '@/lib/correo/auth';
import { envHealth, faltantes } from '@/lib/env';
import { Disclosure, EstadoError, MarcoPagina, Tarjeta } from '../../ui-v2/componentes';
import { TablaBase, type ColumnaBase } from '../../ui-v2/componentes';
import { TarjetaRenglon, type RenglonSistema } from '../renglon-sistema';
import '../sistema.css';

export const dynamic = 'force-dynamic';

type Modelo = { modelo: string; n: number; costoUsd: number };

const COLUMNAS_MODELO: ColumnaBase<Modelo>[] = [
  { id: 'modelo', titulo: 'Modelo', principal: true, celda: (m) => m.modelo },
  { id: 'llamadas', titulo: 'Llamadas', alinear: 'der', celda: (m) => numero(m.n) },
  { id: 'costo', titulo: 'Costo', alinear: 'der', celda: (m) => usd(m.costoUsd) },
];

/**
 * Integraciones — los conectores REALES de los que depende Likida hoy. Su estado está MEDIDO (variables de entorno y configuración de
 * cada servicio, las mismas mediciones que usa Salud: `sentryActivo()`, `correoConfigurado()`, `envHealth()`/`faltantes()`), o dice que
 * no se mide desde aquí. «Configurado» no es «vivo»: el rótulo dice exactamente lo medido; la prueba viva de la base está en Salud.
 *
 * Los proveedores de modelos no son una tarjeta genérica: se listan los modelos que YA corrieron (`resumen.porModelo`, la misma fuente
 * que usa el Inicio), no los que se PODRÍAN usar.
 */
export default async function IntegracionesPage() {
  // A37-S05-01/S06-01: puerta propia; el layout puede no ejecutarse en una petición RSC parcial.
  await requireSuperadmin();
  // Si la lectura de costos cae, los conectores siguen en pie: solo la lista de modelos se queda sin dato (y lo dice).
  const r = await getResumenNegocio().catch((e: unknown) => { logger.error('admin.integraciones.negocio', { err: e instanceof Error ? e.message : String(e) }); return null; });
  const salud = envHealth();
  const falta = faltantes();

  const conectores: RenglonSistema[] = [
    {
      titulo: 'Supabase', marca: 'supabase', link: { href: 'https://supabase.com/dashboard', texto: 'Abrir el panel de Supabase' },
      ...(salud.supabase
        ? { tono: 'ok' as const, etiqueta: 'Llaves completas', detalle: 'La base de datos y el login de toda la app. La prueba viva (una consulta real) está en Estado.' }
        : { tono: 'bad' as const, etiqueta: 'Faltan llaves', detalle: 'La base de datos y el login de toda la app no pueden conectarse completos.', arreglo: `Faltan: ${(falta.supabase ?? []).join(', ')}.` }),
    },
    {
      titulo: 'Resend', marca: 'resend', link: { href: 'https://resend.com/emails', texto: 'Abrir Resend' },
      ...(correoConfigurado()
        ? { tono: 'ok' as const, etiqueta: 'Configurado', detalle: 'Correo transaccional: avisos, invitaciones y, con el enlace encendido, los correos de acceso.' }
        : { tono: 'warn' as const, etiqueta: 'Sin configurar', detalle: 'Ningún correo sale (esperado en local).', arreglo: 'Faltan RESEND_API_KEY o RESEND_EMAIL_DOMAIN en el servidor.' }),
    },
    {
      // EL CORREO DE ACCESO. Se mide el SECRETO, que es lo único que se puede medir desde aquí; que el enlace esté encendido vive en el panel
      // de Supabase. El caso caro es el inverso —encendido allá, sin secreto acá—: responde con error y nadie entra, así que se pinta en ámbar.
      titulo: 'Correo de acceso', link: { href: 'https://supabase.com/dashboard/project/_/auth/hooks', texto: 'Abrir los enlaces de acceso en Supabase' },
      ...(hookDeCorreoConfigurado()
        ? { tono: 'ok' as const, etiqueta: 'Secreto configurado', detalle: 'El enlace de acceso sale por Resend con la plantilla de la marca en vez de la de fábrica de Supabase. Que esté encendido se ve en el panel de Supabase; aquí solo se mide el secreto.' }
        : { tono: 'warn' as const, etiqueta: 'Sin secreto', detalle: 'Si el enlace está ENCENDIDO en Supabase, nadie puede entrar: la ruta de correo de acceso responde con error. Aquí solo se mide el secreto.', arreglo: 'Ver docs/correo-de-acceso.md.' }),
    },
    {
      titulo: 'Sentry', marca: 'sentry', link: { href: 'https://sentry.io', texto: 'Abrir Sentry' },
      ...(sentryActivo()
        ? { tono: 'ok' as const, etiqueta: 'DSN configurado', detalle: 'Registro de errores en producción. Que reciba de verdad se comprueba en su panel, no desde aquí.' }
        : { tono: 'bad' as const, etiqueta: 'Sin DSN', detalle: 'Los errores solo quedan en el registro de ejecución de Vercel.', arreglo: 'Falta el DSN de Sentry en el servidor.' }),
    },
    {
      // Desde adentro no hay nada que medir de Vercel: si esta página renderiza, Vercel ya contestó. Neutral honesto, nunca verde fijo.
      titulo: 'Vercel', marca: 'vercel', link: { href: 'https://vercel.com/dashboard', texto: 'Abrir el panel de Vercel' },
      tono: 'neutral', etiqueta: 'Sin medir', detalle: 'Hosting y despliegues. Vercel ya lo mide en su panel: se enlaza en vez de reconstruirse.',
    },
    {
      titulo: 'WhatsApp Business (Meta)', marca: 'whatsapp', link: { href: '/admin/whatsapp-infra', texto: 'Ir a WhatsApp' },
      ...(salud.whatsapp
        ? { tono: 'ok' as const, etiqueta: 'Variables completas', detalle: 'El número sigue siendo el de PRUEBA de Meta: el bot conversa completo, pero un chofer real aún no puede escribirle. Falta el número mexicano y la verificación del negocio.' }
        : { tono: 'bad' as const, etiqueta: 'Faltan variables', detalle: 'La conexión con WhatsApp no tiene todas sus variables. Además el número sigue siendo el de PRUEBA de Meta.', arreglo: `Faltan: ${(falta.whatsapp ?? []).join(', ')}.` }),
    },
  ];

  return (
    <MarcoPagina titulo="Integraciones" apoyo="Los servicios reales de los que depende Likida hoy. Cada estado está medido en este entorno, o dice que no se mide desde aquí.">
      <section className="adm-sis-bloque" aria-labelledby="conectores">
        <h2 className="adm-sis-titulo" id="conectores">Conectores</h2>
        <div className="adm-sis-rejilla">
          {conectores.map((c) => <TarjetaRenglon key={c.titulo} r={c} />)}
        </div>
      </section>

      {r === null ? (
        <EstadoError reintentar>No se pudo leer el gasto por modelo. Los conectores de arriba no dependen de esa lectura.</EstadoError>
      ) : (
        <Tarjeta titulo="Proveedores de modelos de IA" estado={r.porModelo.length === 0 ? 'vacio' : 'ok'} mensaje="Sin llamadas registradas todavía" detalle="Aparecen aquí los modelos en cuanto corren OCR o Cuadre por primera vez.">
          <p className="adm-sis-nota">No es un catálogo de lo que se podría usar: son los modelos que ya corrieron, tal como quedaron en el registro de costos.</p>
          <TablaBase etiqueta="Modelos que ya corrieron" columnas={COLUMNAS_MODELO} filas={r.porModelo} idFila={(m) => m.modelo} densa tarjetaMovil />
        </Tarjeta>
      )}

      <Disclosure titulo="Lo que aún no existe aquí" resumen="Rotación de llaves">
        <p className="adm-sis-nota">
          La rotación de llaves de API no existe todavía: hoy las llaves de cada servicio viven en las variables del servidor en Vercel, sin una pantalla de administración ni rotación automática dentro de este panel.
        </p>
      </Disclosure>
    </MarcoPagina>
  );
}

export const metadata: Metadata = { title: 'Integraciones' };
