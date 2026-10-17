# Vigía: paquete para Meta (número y plantillas)

> Lista para que **Javier** gestione el alta del número y la aprobación de las plantillas del Vigía (Agente 4). Este documento no ejecuta nada: ningún paso manda datos a Meta ni usa llaves. Los textos de abajo son los del catálogo versionado (`src/lib/meta/plantillas_catalogo.ts`, agente `vigia_cliente`) y una prueba (`src/lib/meta/vigia_meta_checklist.test.ts`) falla si dejan de coincidir. El catálogo completo y las reglas generales están en `plantillas-meta.md`.

Alcance: solo las plantillas del Vigía. Las de otros agentes (conductor, liquidación, jornada…) no se tocan aquí.

## 1. Alta del WABA y del número (la hace Javier en Meta)

1. Cuenta de Meta Business verificada (la verificación del negocio puede tardar días; empezar primero por ahí).
2. WhatsApp Business Account (WABA) con un número propio que **no** esté en uso en la app de WhatsApp normal. Solo se necesita para los agentes que quedaron en alcance (Vigía y Conductor).
3. Perfil del negocio completo (nombre visible, categoría, descripción) y método de pago en la cuenta de Meta.
4. Registrar el número en la Cloud API y suscribir el webhook de la app de Likida al WABA.
5. Guardar `WHATSAPP_ACCESS_TOKEN` y `WHATSAPP_BUSINESS_ACCOUNT_ID` **solo** en el almacén de secretos del despliegue. Nunca en el repositorio, en un chat ni en este documento.

## 2. Reglas que Meta aplica a estas plantillas

- Categoría **UTILITY** (operativa/transaccional), idioma **es_MX**. Si Meta las reclasifica a MARKETING, salen más caras y con más límites: apelar o reescribir.
- Una plantilla aprobada **no se edita**: un cambio de texto es un nombre nuevo (`_v2`).
- Variables `{{1}}…{{n}}` consecutivas; el cuerpo no empieza ni termina con variable; los valores no llevan saltos de línea.
- Cada variable lleva un **ejemplo** al someterla (los de abajo son ficticios).
- La licencia y el teléfono del operador **nunca** van en una plantilla.

## 3. Las 5 plantillas del Vigía (copiar y pegar)

Tres ya tienen llamador en el código (`vigia_respuesta_cliente_v1`, `vigia_aprobacion_v1`, `vigia_escalamiento_v1`) y dos son nuevas del aviso proactivo (`vigia_aviso_viaje_v1`, `vigia_aviso_cambio_v1`). Las cinco están en estado «nueva para aprobación». Las dos del aviso proactivo son una **reconstrucción** del texto: cotejarlas contra lo que Meta devuelva.

### 3.1 `vigia_respuesta_cliente_v1`

- Categoría UTILITY · idioma `es_MX` · sin botones.
- Uso: respuesta de la flota a un cliente (ya aprobada por el gerente) cuando su ventana de 24 h está cerrada.

Cuerpo:

```text
Respuesta de {{1}} sobre tu servicio de transporte: {{2}} Si ya no quieres recibir mensajes por este medio, responde BAJA.
```

| Variable | Qué es | Ejemplo para Meta |
| --- | --- | --- |
| `{{1}}` | razón social de la flota | Transportes del Norte |
| `{{2}}` | texto de la respuesta (≤ 300 caracteres, sin saltos de línea) | Tu viaje F-1042 va en curso; la última posición del GPS es de hace 12 minutos. |

### 3.2 `vigia_aprobacion_v1`

- Categoría UTILITY · idioma `es_MX`.
- Uso: pedir al gerente, con un toque, que apruebe la respuesta redactada para un cliente.

Cuerpo:

```text
Vigía de servicio: {{1}} escribió «{{2}}». Respuesta propuesta: «{{3}}». ¿La envío?
```

| Variable | Qué es | Ejemplo para Meta |
| --- | --- | --- |
| `{{1}}` | cliente | Compras Acme |
| `{{2}}` | mensaje del cliente (≤ 160 caracteres) | ¿Dónde va mi viaje F-1042? |
| `{{3}}` | respuesta propuesta (≤ 280 caracteres) | Tu viaje F-1042 va en curso; última posición hace 12 minutos. |

Botones de respuesta rápida: «Enviar», «No enviar», «Yo me encargo».

### 3.3 `vigia_escalamiento_v1`

- Categoría UTILITY · idioma `es_MX`.
- Uso: escalar al gerente (nivel 1) o al dueño (nivel 2) un cliente molesto, que pide un humano o que lleva más del plazo sin respuesta.

Cuerpo:

```text
Vigía de servicio: el cliente {{1}} necesita atención ({{2}}). Nivel {{3}} de escalamiento. Revísalo en {{4}} o toca «Yo me encargo».
```

| Variable | Qué es | Ejemplo para Meta |
| --- | --- | --- |
| `{{1}}` | cliente | Compras Acme |
| `{{2}}` | motivo (sin respuesta, molestia, pide un humano…) | lleva 45 minutos sin respuesta |
| `{{3}}` | nivel (1 o 2) | 1 |
| `{{4}}` | liga al tablero del Vigía | https://app.likida.ai/dashboard/agentes/vigia |

Botón de respuesta rápida: «Yo me encargo».

### 3.4 `vigia_aviso_viaje_v1` (nueva, texto reconstruido)

- Categoría UTILITY · idioma `es_MX` · sin botones.
- Uso: aviso proactivo al cliente de la caja, la unidad y el operador asignados a su servicio.

Cuerpo:

```text
Aviso de viaje de {{1}}: asignamos {{2}} (caja) con {{3}} (unidad) y {{4}} (operador) para tu cita del {{5}}. Responde a este mensaje si algo no coincide.
```

| Variable | Qué es | Ejemplo para Meta |
| --- | --- | --- |
| `{{1}}` | razón social de la flota | Transportes del Norte |
| `{{2}}` | caja y placas (una sola línea) | caja CJ-101, placas 11AA22 |
| `{{3}}` | unidad y placas (una sola línea) | unidad U-101, placas 33BB44 |
| `{{4}}` | nombre del operador | Operador Demo |
| `{{5}}` | hora de la cita | 02/10/2026 07:00 |

### 3.5 `vigia_aviso_cambio_v1` (nueva, texto reconstruido)

- Categoría UTILITY · idioma `es_MX` · sin botones.
- Uso: actualización al cliente cuando cambió la caja, la unidad o el operador de un servicio ya avisado.

Cuerpo:

```text
Actualización del aviso de viaje de {{1}}: la asignación quedó con {{2}} (caja), {{3}} (unidad) y {{4}} (operador) para tu cita del {{5}}. Responde a este mensaje si algo no coincide.
```

| Variable | Qué es | Ejemplo para Meta |
| --- | --- | --- |
| `{{1}}` | razón social de la flota | Transportes del Norte |
| `{{2}}` | caja y placas (una sola línea) | caja CJ-101, placas 11AA22 |
| `{{3}}` | unidad y placas (una sola línea) | unidad U-205, placas 55CC66 |
| `{{4}}` | nombre del operador | Operador Demo |
| `{{5}}` | hora de la cita | 02/10/2026 07:00 |

## 4. Tiempos y qué pasa mientras tanto

- Meta tarda de minutos a **2–5 días hábiles** por plantilla; la verificación del negocio puede sumar días. Conviene empezar hoy.
- Mientras una plantilla no esté `APPROVED`, un envío fuera de la ventana de 24 h devuelve el código `132001`: queda registrado en `wa_envio_registro` con su motivo y no se reintenta en cada pasada (falla cerrado y lo dice).
- **Dentro de la ventana de 24 h** (el contacto escribió en las últimas 24 h) el Vigía responde con texto libre o botones y no necesita plantilla.
- El canal ejecutivo (gerente que aprueba o recibe el escalamiento) funciona mientras su ventana esté abierta; fuera de ella necesita `vigia_aprobacion_v1` o `vigia_escalamiento_v1`.
- Las funciones que usan estas plantillas nacen apagadas por defecto y se encienden por flota: no hace falta tener las cinco aprobadas para enseñar lo que ya funciona dentro de la ventana.

## 5. Comprobar el estado (lo corre Javier, no el bucle ni CI)

1. En seco (no toca la red; imprime el plan): `npx tsx scripts/verificar-plantillas-meta.ts`
2. Consultar a Meta (solo lectura, `GET /{WABA}/message_templates`; necesita las dos variables del paso 1.5 en el entorno): `npx tsx scripts/verificar-plantillas-meta.ts --consultar`
3. El script compara estado de aprobación, categoría, idioma, cuerpo y botones contra el catálogo y marca desviaciones.
4. Someter las que Meta no tenga: `npx tsx scripts/verificar-plantillas-meta.ts --consultar --crear --confirmo-meta-real`. Escribe en la cuenta real de Meta, por eso exige las tres banderas juntas (sin alguna, el script sale con código 2 y no somete nada); es decisión de Javier. Se puede someter a mano desde el Administrador de WhatsApp copiando los textos de la sección 3.

## 6. Qué no hace este paquete

- No manda nada a Meta, no usa llaves ni toca la cuenta real.
- No incluye plantillas de otros agentes.
- Los textos de `vigia_aviso_viaje_v1` y `vigia_aviso_cambio_v1` son reconstruidos: si Meta pide cambios, se crea una versión nueva (`_v2`) en el catálogo y se regenera `plantillas-meta.md`.
