// Genera docs/operacion/plantillas-meta.md a partir del catálogo. El documento
// NO se edita a mano: `plantillas_catalogo.test.ts` falla si no coincide con esta
// salida. Regenerar: `npx tsx scripts/generar-doc-plantillas.ts`.
import { CATALOGO_PLANTILLAS, type PlantillaCatalogo, type BotonCatalogo } from './plantillas_catalogo';

const AGENTES: Record<PlantillaCatalogo['agente'], string> = {
  chofer_asignacion: 'Chofer — asignación de viaje',
  chofer_cobranza: 'Chofer — cobranza de comprobantes / recordatorio de aceptación',
  oficina: 'Oficina / jefe de tráfico',
  facturacion: 'Facturación',
  privacidad_arco: 'Privacidad (ARCO)',
  gps: 'GPS',
  asistencia: 'Asistencia en carretera',
  mis_reglas: 'Mis reglas (vigilante)',
  agente5_conductor: 'Agente 5 — Conductor',
  onboarding_operador: 'Alta de operadores (invitación del chofer)',
};

function botonTexto(b: BotonCatalogo): string {
  return b.tipo === 'QUICK_REPLY'
    ? `«${b.texto}» (respuesta rápida, payload \`${b.payloadPrefijo}:<viaje_id>\`)`
    : `«${b.texto}» (URL fija ${b.url})`;
}

function bloque(p: PlantillaCatalogo): string {
  const l: string[] = [];
  l.push(`### \`${p.nombre}\``);
  l.push('');
  l.push(`- **Categoría:** ${p.categoria} · **Idioma:** \`${p.idioma}\` · **Versión:** ${p.version}`);
  l.push(`- **Agente / uso:** ${AGENTES[p.agente]}. ${p.proposito}`);
  l.push(`- **Llamador en código:** ${p.llamador ?? 'ninguno todavía (la usará el Agente 5)'}`);
  l.push(`- **Texto verificado contra Meta:** ${p.textoVerificado ? 'sí (texto autoritativo del catálogo)' : '**NO** — reconstruido del código; cotejar con `scripts/verificar-plantillas-meta.ts`'}`);
  if (p.encabezado) l.push(`- **Encabezado:** ${p.encabezado.tipo === 'TEXT' ? `texto «${p.encabezado.texto}»` : p.encabezado.tipo}`);
  l.push('- **Cuerpo exacto:**');
  l.push('');
  l.push('  ```text');
  for (const linea of p.cuerpo.split('\n')) l.push(`  ${linea}`);
  l.push('  ```');
  if (p.variables.length > 0) {
    l.push('');
    l.push('| Variable | Qué es | Ejemplo para Meta |');
    l.push('| --- | --- | --- |');
    p.variables.forEach((v, i) => l.push(`| \`{{${i + 1}}}\` | ${v} | ${p.ejemplos[i].replace(/\|/g, '\\|')} |`));
  }
  l.push('');
  l.push(`- **Botones:** ${p.botones.length === 0 ? 'ninguno' : p.botones.map(botonTexto).join('; ')}`);
  l.push('');
  return l.join('\n');
}

export function renderizarDocPlantillas(catalogo: readonly PlantillaCatalogo[] = CATALOGO_PLANTILLAS): string {
  const enUso = catalogo.filter((p) => p.estado === 'en_uso');
  const nuevas = catalogo.filter((p) => p.estado === 'nueva_para_aprobacion');
  const l: string[] = [];
  l.push('# Plantillas de WhatsApp (Meta) — catálogo versionado');
  l.push('');
  l.push('> Generado desde `src/lib/meta/plantillas_catalogo.ts`. **No editar a mano**: una prueba falla si difiere. Regenerar con `npx tsx scripts/generar-doc-plantillas.ts`.');
  l.push('');
  l.push('## Por qué hay plantillas');
  l.push('');
  l.push('WhatsApp solo entrega texto libre y botones interactivos dentro de las **24 h posteriores al último mensaje del usuario**. Fuera de esa ventana, lo único que entra es una plantilla **aprobada por Meta**. Likida registra ese último mensaje por contacto (migración 0360, `wa_ventana_contacto`) y el selector `enviarConFallback` (`src/lib/meta/enviar_con_fallback.ts`) decide: ventana abierta → texto o botones; cerrada → plantilla; desconocida → texto y, si Meta lo rechaza por ventana (131047/131026/131042), plantilla. Cada decisión queda en `wa_envio_registro` con su motivo.');
  l.push('');
  l.push('## Reglas del catálogo');
  l.push('');
  l.push('- Todas **UTILITY** (operativas/transaccionales), idioma **es_MX** (excepción documentada: `respuesta_arco_v2` se aprobó en `es`).');
  l.push('- Una plantilla aprobada **no se edita**: un cambio de texto es un nombre nuevo (`_v2`). El nombre+idioma es único.');
  l.push('- Variables `{{1}}…{{n}}` consecutivas; el cuerpo no empieza ni termina con variable; los parámetros no llevan saltos de línea, tabuladores ni más de 4 espacios seguidos (el código los normaliza y rechaza los vacíos antes de llamar a Meta).');
  l.push('- **Una plantilla no puede pedir ubicación**: la Cloud API solo ofrece la solicitud como mensaje interactivo dentro de la ventana (`enviarSolicitudUbicacion`). Las plantillas del conductor traen un botón «Compartir ubicación»; al apretarlo el chofer abre la ventana y el sistema responde con la solicitud interactiva.');
  l.push('- Payload de botones de respuesta rápida: `<prefijo>:<viaje_id>` (≤ 128 caracteres); llega al webhook como cuerpo del mensaje del botón.');
  l.push('- Referencias de Meta: <https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview> · <https://developers.facebook.com/docs/whatsapp/api/messages/message-templates/interactive-message-templates/> · <https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/location-request-messages>');
  l.push('');
  l.push('## Cómo someterlas y verificarlas (sin ejecutar nada contra Meta desde CI)');
  l.push('');
  l.push('1. **Verificar el estado** de todas (solo lectura, `GET /{WABA}/message_templates`): `npx tsx scripts/verificar-plantillas-meta.ts` — sin credenciales muestra el plan en seco; con `WHATSAPP_ACCESS_TOKEN` y `WHATSAPP_BUSINESS_ACCOUNT_ID` y la bandera `--consultar` consulta a Meta y compara estado de aprobación, categoría, idioma, cuerpo y botones contra este catálogo.');
  l.push('2. **Someter las nuevas**: el mismo script con `--crear --confirmo-meta-real` hace `POST /{WABA}/message_templates` SOLO de las que Meta no tiene. Sin esas dos banderas no escribe nada.');
  l.push('3. Aprobación: Meta tarda de minutos a 2–5 días hábiles. Hasta que una plantilla esté `APPROVED`, el envío devuelve `132001` y el selector lo reporta con ese motivo (fail-closed y dicho).');
  l.push('4. Si Meta reclasifica una plantilla a MARKETING, el script lo marca como desviación: sale más cara y con más límites; hay que apelar o reescribir.');
  l.push('');
  l.push(`## Plantillas en uso (${enUso.length})`);
  l.push('');
  for (const p of enUso) l.push(bloque(p));
  l.push(`## Plantillas nuevas, listas para enviar a aprobación (${nuevas.length})`);
  l.push('');
  for (const p of nuevas) l.push(bloque(p));
  return l.join('\n');
}
