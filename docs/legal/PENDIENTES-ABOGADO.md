# Pendientes de abogado — antes del piloto con Innovativos

**Estado:** interno. No se publica en ningún sitio ni ruta de la app —
`grep -rn PENDIENTES-ABOGADO src/` debe seguir dando 0. Es el índice de una
sola página para que quien contrate al abogado externo sepa exactamente qué
falta cerrar, sin tener que leer los cinco documentos de esta carpeta.

Este archivo **no redacta cláusulas**: solo dice qué falta y dónde vive la
plantilla. El texto jurídico lo escribe el abogado a partir de esas plantillas.

## Por qué existe (auditoría 24, LEG-7, ALTO)

`/terminos` en producción declaraba, en una página pública sin sesión, que
«el contrato de encargado del tratamiento está pendiente de firma». El hecho
sigue siendo cierto — no hay un DPA firmado con ningún cliente — pero
anunciarlo así en la página pública, con el texto tal cual, es peor que
necesario: cualquiera que visita el sitio antes de ser cliente lo lee.
`/terminos` ya no dice esa frase (remite al contacto). El hecho de fondo
—que no hay nada firmado— vive aquí, donde corresponde: en un documento
interno para quien va a cerrarlo, no en un documento público para quien
apenas está evaluando el servicio.

## 1. DPA / contrato de encargado del tratamiento — `[COMPLETAR]`

- Plantilla: `01-DPA-PLANTILLA.md` (esta misma carpeta). 8 campos
  `[COMPLETAR]` en el cuerpo, más las dos firmas.
- Insumo de subencargados para la §4 del DPA: la sección 2 de abajo.
- Cuando el abogado lo cierre y haya versión firmada: cargar
  `LEGAL_DPA_VERSION` en Vercel. `/terminos` §17 deja de remitir al contacto
  y cita la versión (ver `estadoLegalProduccion()` en
  `src/lib/legal/config.ts`).

## 2. Anexo de subencargados — `[COMPLETAR]`

- Plantilla contractual: `04-SUBENCARGADOS-PLANTILLA.md` (esta carpeta) — la
  tabla está vacía, `[COMPLETAR]` en cada celda.
- Insumo técnico (la cadena real, derivada del código, NO un contrato):
  `docs/conocimiento/52-anexo-subencargados.md`. Cubre Meta, OpenRouter (y
  Google/Anthropic/OpenAI debajo), Supabase, Vercel, Sentry y Resend/SES.
- **Le faltan tres eslabones que sí existen en el código y hoy no están en
  ningún anexo** (medido en la auditoría 24, LEG-7):
  - **Stripe** — procesador de pagos de la mensualidad (`src/lib/saas/stripe.ts`).
    Recibe razón social, RFC, código postal, régimen fiscal y correo de
    facturación del cliente, y los datos de la tarjeta.
  - **Upstash** — hoy solo aparece nombrado como dependencia técnica en
    `docs/conocimiento/52-anexo-subencargados.md:165`, no como eslabón de la
    cadena de datos personales.
  - **El PAC** (proveedor autorizado de certificación) que timbra el Carta
    Porte — recibe RFC y número de licencia del operador
    (`carta_porte_xml.ts`).
- Esta tabla y la de `docs/conocimiento/52-anexo-subencargados.md` no están
  sincronizadas — actualizar esa segunda tabla con los tres eslabones de
  arriba es trabajo de código/documentación, no de este archivo.
- Cuando el abogado lo cierre: cargar `LEGAL_SUBPROCESSORS_VERSION` en
  Vercel.

## 3. SLA — `[COMPLETAR]` (no bloquea el piloto)

- Plantilla: `02-SLA-PLANTILLA.md`. Cargar `LEGAL_SLA_VERSION` cuando exista.

## 4. Anexo de seguridad — `[COMPLETAR]` (no bloquea el piloto)

- Plantilla: `03-ANEXO-SEGURIDAD-PLANTILLA.md`. Cargar
  `LEGAL_SECURITY_ANNEX_VERSION` cuando exista.

## Lo que SÍ bloquea el alta de una flota nueva hoy

Ver `REQUISITOS_ENTIDAD` en `src/lib/legal/config.ts`: `LEGAL_ENTITY_NAME`,
`LEGAL_ENTITY_ADDRESS`, `LEGAL_JURISDICTION`, `LEGAL_CONTACT_EMAIL`. Esos
cuatro SÍ bloquean el build en producción (`exigirLegalEnProduccion`); los
cuatro documentos de arriba NO bloquean el build por diseño — ver el porqué
en el comentario de esa misma función. `00-CHECKLIST-ENTERPRISE.md` trae el
checklist completo de salida enterprise, de identidad a gate técnico.
