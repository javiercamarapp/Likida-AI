// Genera docs/operacion/plantillas-meta.md a partir del catálogo. El documento
// NO se edita a mano: `plantillas_catalogo.test.ts` falla si no coincide con esta
// salida. Regenerar: `npx tsx scripts/generar-doc-plantillas.ts`.
import { CATALOGO_PLANTILLAS, type PlantillaCatalogo, type BotonCatalogo } from './plantillas_catalogo';
import {
  perfilDePlantilla, PLANTILLAS_CICLO, ESTADO_PROVEEDOR_CICLO, plantillasDelCicloPorPerfil, type EstadoProveedor,
} from '@/lib/likida/conductor/plantillas_requeridas';

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
  agente5_ciclo: 'Agente 5 — Conductor (ciclo con botones)',
  onboarding_operador: 'Alta de operadores (invitación del chofer)',
  vigia_cliente: 'Agente 4 — Vigía de servicio al cliente',
  liquidacion_externa: 'Agente 1 — Liquidación externa (entrega al chofer)',
  jornada: 'Agente 12 — Jornada (alerta de tope)',
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
    p.variables.forEach((v, i) => l.push(`| \`{{${i + 1}}}\` | ${v} | ${p.ejemplos[i].replace(/\\/g, '\\\\').replace(/\|/g, '\\|')} |`));
  }
  l.push('');
  l.push(`- **Botones:** ${p.botones.length === 0 ? 'ninguno' : p.botones.map(botonTexto).join('; ')}`);
  l.push('');
  return l.join('\n');
}

/** La lista corta para quien somete: una fila por plantilla pendiente, sin el cuerpo (que vive en el bloque de abajo). */
function tablaPorSometer(nuevas: readonly PlantillaCatalogo[]): string[] {
  const l: string[] = [];
  l.push('| # | Plantilla | Agente | Perfil (esenciales / completo) | Llamador en código | Variables | Botones | Texto |');
  l.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  nuevas.forEach((p, i) => {
    const botones = p.botones.length === 0 ? '—' : p.botones.map((b) => `«${b.texto}»`).join(', ');
    const llamador = p.llamador === null ? 'sin llamador todavía' : p.llamador.split(', ').map((x) => `\`${x}\``).join(', ');
    const texto = p.textoVerificado ? 'autoritativo' : 'reconstruido: cotejar';
    l.push(`| ${i + 1} | \`${p.nombre}\` | ${AGENTES[p.agente]} | ${perfilDePlantilla(p.nombre)} | ${llamador} | ${p.variables.length} | ${botones} | ${texto} |`);
  });
  return l;
}

const ESTADO_TEXTO: Record<EstadoProveedor, string> = {
  no_enviada: 'no enviada', pendiente: 'pendiente', aprobada: 'aprobada', rechazada: 'rechazada',
};

/** Las 12 del ciclo del conductor (N01–N12): prioridad, perfil que la exige y estado ante Meta (T-A5-59). */
function seccionCiclo(catalogo: readonly PlantillaCatalogo[]): string[] {
  const l: string[] = [];
  const piloto = new Set(plantillasDelCicloPorPerfil('piloto'));
  const cinco = new Set(plantillasDelCicloPorPerfil('cinco_agentes'));
  l.push('## Las 12 plantillas del ciclo del conductor (N01–N12)');
  l.push('');
  l.push('Perfil **piloto** exige las P0; perfil **cinco_agentes** exige P0 y P1; la P2 es opcional. La columna «Estado en el proveedor» es lo asentado a mano en `ESTADO_PROVEEDOR_CICLO` (`src/lib/likida/conductor/plantillas_requeridas.ts`): no se consulta a Meta al generar este documento; `scripts/verificar-plantillas-meta.ts --consultar` lo contrasta.');
  l.push('');
  l.push('- **Antes de crear nada en Meta:** comparar con la lista existente (`whatsapp_biz_list_templates`) para no duplicar; el script solo somete las que Meta no tiene.');
  l.push('- **Versionado:** una aprobada no se edita. Si Meta rechaza una o su texto debe cambiar, se corrige el catálogo con nombre nuevo, sufijo `_v2` (`siguienteVersion`), y se marca aquí el estado de la nueva.');
  l.push('- Rampa, motivo de parada, «¿cómo descargas?» y resultado de descarga no necesitan plantilla: son mensajes interactivos dentro de la ventana de 24 h.');
  l.push('');
  l.push('| Código | Plantilla | Prioridad | Piloto | cinco_agentes | Estado en el proveedor | Llamador en código |');
  l.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const c of PLANTILLAS_CICLO) {
    const p = catalogo.find((x) => x.nombre === c.nombre);
    const llamador = p === undefined ? 'fuera del catálogo' : p.llamador === null ? 'sin llamador todavía' : `\`${p.llamador}\``;
    l.push(`| ${c.codigo} | \`${c.nombre}\` | ${c.prioridad} | ${piloto.has(c.nombre) ? 'sí' : 'no'} | ${cinco.has(c.nombre) ? 'sí' : 'no'} | ${ESTADO_TEXTO[ESTADO_PROVEEDOR_CICLO[c.nombre]]} | ${llamador} |`);
  }
  l.push('');
  return l;
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
  l.push('WhatsApp solo entrega texto libre y botones interactivos dentro de las **24 h posteriores al último mensaje del usuario**. Fuera de esa ventana, lo único que entra es una plantilla **aprobada por Meta**. Likida registra ese último mensaje por contacto (migración 0368, `wa_ventana_contacto`) y el selector `enviarConFallback` (`src/lib/meta/enviar_con_fallback.ts`) decide: ventana abierta → texto o botones; cerrada → plantilla; desconocida → texto y, si Meta lo rechaza por ventana (131047/131026/131042), plantilla. Cada decisión queda en `wa_envio_registro` con su motivo.');
  l.push('');
  l.push('## Reglas del catálogo');
  l.push('');
  l.push('- Todas **UTILITY** (operativas/transaccionales), idioma **es_MX** (excepción documentada: `respuesta_arco_v2` se aprobó en `es`).');
  l.push('- Una plantilla aprobada **no se edita**: un cambio de texto es un nombre nuevo (`_v2`). El nombre+idioma es único.');
  l.push('- Variables `{{1}}…{{n}}` consecutivas; el cuerpo no empieza ni termina con variable; los parámetros no llevan saltos de línea, tabuladores ni más de 4 espacios seguidos (el código los normaliza y rechaza los vacíos antes de llamar a Meta).');
  l.push('- **Una plantilla no puede pedir ubicación**: la Cloud API solo ofrece la solicitud como mensaje interactivo dentro de la ventana (`enviarSolicitudUbicacion`). Las plantillas del conductor traen un botón «Compartir ubicación»; al apretarlo el chofer abre la ventana y el sistema responde con la solicitud interactiva.');
  l.push('- Payload de botones de respuesta rápida: `<prefijo>:<viaje_id>` (≤ 128 caracteres); llega al webhook como cuerpo del mensaje del botón. Los botones de los recordatorios del Agente 5 añaden el hito: `<prefijo>:<viaje_id>:<hito>`.');
  l.push('- Referencias de Meta: <https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview> · <https://developers.facebook.com/docs/whatsapp/api/messages/message-templates/interactive-message-templates/> · <https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/location-request-messages>');
  l.push('');
  l.push('## Cómo someterlas y verificarlas (sin ejecutar nada contra Meta desde CI)');
  l.push('');
  l.push('1. **Verificar el estado** de todas (solo lectura, `GET /{WABA}/message_templates`): `npx tsx scripts/verificar-plantillas-meta.ts` — sin credenciales muestra el plan en seco; con `WHATSAPP_ACCESS_TOKEN` y `WHATSAPP_BUSINESS_ACCOUNT_ID` y la bandera `--consultar` consulta a Meta y compara estado de aprobación, categoría, idioma, cuerpo y botones contra este catálogo.');
  l.push('2. **Someter las nuevas**: el mismo script con `--crear --confirmo-meta-real` hace `POST /{WABA}/message_templates` SOLO de las que Meta no tiene. Sin esas dos banderas no escribe nada.');
  l.push('3. Aprobación: Meta tarda de minutos a 2–5 días hábiles. Hasta que una plantilla esté `APPROVED`, el envío devuelve `132001` y el selector lo reporta con ese motivo (fail-closed y dicho).');
  l.push('4. Si Meta reclasifica una plantilla a MARKETING, el script lo marca como desviación: sale más cara y con más límites; hay que apelar o reescribir.');
  l.push('');
  l.push(`## Lista consolidada por someter a Meta (${nuevas.length})`);
  l.push('');
  l.push('Todas las que siguen en estado «nueva para aprobación»: el código ya las nombra (o las nombrará) y, mientras Meta no las apruebe, el envío fuera de la ventana de 24 h devuelve `132001`, queda dicho en `wa_envio_registro` y NO se reintenta en cada pasada. Las funciones que las usan nacen **apagadas por defecto** y se encienden por flota; no hace falta aprobar todas para el demo, solo las de lo que se vaya a enseñar en vivo.');
  l.push('');
  l.push(...tablaPorSometer(nuevas));
  l.push('');
  l.push('El cuerpo exacto, las variables con su ejemplo y los botones de cada una están en el bloque de más abajo (los mismos que `scripts/verificar-plantillas-meta.ts --crear` manda a Meta).');
  l.push('');
  l.push(...seccionCiclo(catalogo));
  l.push(`## Plantillas en uso (${enUso.length})`);
  l.push('');
  for (const p of enUso) l.push(bloque(p));
  l.push(`## Plantillas nuevas, listas para enviar a aprobación (${nuevas.length})`);
  l.push('');
  for (const p of nuevas) l.push(bloque(p));
  return l.join('\n');
}
