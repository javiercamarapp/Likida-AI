# Avisos por correo (canal genérico) y modo primer mes de Carta Porte

Código: `src/lib/likida/avisos_correo.ts` (canal genérico), `src/lib/likida/carta_porte_docs/{avisos_documento_correo,primer_mes}.ts` (uso de Carta Porte).
Migración: `0938_cp_primer_mes_revisores.sql` (dos columnas aditivas en `cp_salida_config`).

## Para qué sirve

Los avisos de los agentes salían solo por WhatsApp (Meta, con la verificación de negocio rechazada). Cuando WhatsApp no sale, el aviso
se perdía: el caso quedaba visible solo dentro de la bandeja. `enviarAvisoCorreo` es la puerta única para el segundo canal (Resend, el mismo
que usan facturas y alertas).

## Reglas del canal (todas fallan cerrado y nunca lanzan)

- Sin `tenantId` no se manda nada.
- El **asunto** es genérico: si trae un correo, un RFC, 6 o más dígitos seguidos, un importe, una URL o saltos de línea, el aviso se **rechaza**
  (`asunto_inseguro`), no se recorta. El detalle va en el cuerpo y detrás de la liga (que exige sesión).
- Destinatarios: formato válido, sin repetir, máximo 10. Sin ninguno válido: `sin_destinatarios`.
- Sin `RESEND_API_KEY` o `RESEND_EMAIL_DOMAIN`: `sin_configurar` (canal apagado, no es un fallo).
- La llave de idempotencia de Resend se deriva de `(flota, agente, tipo, clave)`: un reintento tras un timeout ambiguo no manda dos correos.

## Cómo lo usará otro agente (A2 Peajes, Vigía)

```ts
import { enviarAvisoCorreo } from '@/lib/likida/avisos_correo';

const r = await enviarAvisoCorreo({
  tenantId,                         // obligatorio
  agente: 'peajes',                 // o 'vigia'
  tipo: 'reclamacion_por_vencer',   // clave del aviso, sin datos
  asunto: 'Peajes: una reclamación vence pronto',   // genérico
  titulo: 'Una reclamación vence pronto',
  parrafos: ['Revísala antes del plazo.'],          // sin datos que no deban viajar por correo
  referencia: idCorto,              // 8 hex del id del caso
  liga: `${appUrl()}/dashboard/agentes/peajes/reclamacion`,
  para: [correoDelDestinatario],
  clave: idDelCaso,                 // idempotencia
});
// r.ok === false → r.motivo: sin_tenant | sin_destinatarios | asunto_inseguro | sin_configurar | rechazado | red
```

Patrón recomendado (el de `worker.ts`): el correo es un canal **propio**, no un respaldo del WhatsApp. El candado de "avisado una sola vez" se
queda cerrado si **cualquiera** de los dos canales salió; solo se suelta si todos fallaron de forma definitiva.

## Avisos de Carta Porte (worker de la bandeja)

`documento por revisar` (hallazgos) y `no se pudo leer` (agotado) ahora salen también por correo. Destinatarios:

| Aviso | Orden |
| --- | --- |
| hallazgos | persona asignada al documento → correo de revisión → correo de alerta |
| agotado | correo de alerta → correo de revisión |

Más, en el primer mes, los revisores por departamento. El texto es el de WhatsApp (solo conteos y un código del documento).

## Modo primer mes

Pantalla: `/dashboard/agentes/carta-porte/configuracion` (sección "Primer mes"). Se guarda por flota en `cp_salida_config`:
`primer_mes_hasta` (día inclusive, hora de México; vacío = apagado) y `revisores_departamento` (`Departamento: correo`, un renglón cada uno, hasta 20).

Mientras esté vigente, cada movimiento se copia por correo a esos revisores: documento leído (`lectura_lista`), aprobado, rechazado, subido a mano
y, con el envío listo, la alerta "listo para subir" (se suman como destinatarios). No viaja ningún campo leído ni el nombre del archivo: solo qué pasó,
un código de 8 caracteres y la liga al visor. Es de mejor esfuerzo: un fallo del correo nunca tumba la lectura, la aprobación ni el envío.

Sin la migración 0938 el modo queda apagado (se registra `cartaporte_docs.primer_mes_sin_migracion`) y la pantalla lo dice.

## Cómo apagarlo

- Primer mes: vaciar la fecha y los revisores en la pantalla, o `update cp_salida_config set primer_mes_hasta = null where tenant_id = '…'`.
- Todo el canal: quitar `RESEND_API_KEY` (los avisos devuelven `sin_configurar`; WhatsApp sigue como siempre).
- Reversa de la migración: ver la cabecera de `0938_cp_primer_mes_revisores.sql`.

## Catálogo SAT (`cp_sat_catalogo`)

Sin filas la validación SAT **no bloquea nada** (degrada a aviso). Para cargarlo (lo hace una persona con el archivo oficial del SAT o la exportación del TMS;
este cambio no carga datos):

```
NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/importar-catalogo-sat.ts <archivo.xls|.xlsx|.csv> [--catalogo c_ClaveProdServCP]
```

Un archivo por catálogo (`c_ClaveProdServCP`, `c_ClaveUnidad`, `c_Pais`, `c_Estado`…). Reimportar el mismo archivo no duplica (upsert por catálogo y clave).
Filas sin clave se rechazan y se listan. Verificado: el script valida sus argumentos, falla cerrado sin las variables y sus 10 pruebas pasan.

## Adaptador `SalidaTms` de producción (pendiente de la especificación del cliente)

El punto de extensión es `fijarProveedorSalida` (`worker_envios_deps.ts`) y el puerto `SalidaTms` (`tms_puerto.ts`). La prueba de contrato está lista:
`describirContratoSalidaTms('mi adaptador', () => crearAdaptador(...))` en `tms_contrato.fixture.ts` (el doble en memoria ya la cumple en
`tms_contrato.test.ts`).
