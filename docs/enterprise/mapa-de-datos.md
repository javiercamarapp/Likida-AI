# Mapa de datos por agente

> Generado de `src/lib/likida/offboarding/mapa_datos.ts`; no se edita a mano. Los plazos de retención viven en `docs/legal/RETENCION.md` (cifra final: decisión D7, pendiente). Los subencargados vienen de `docs/conocimiento/52-anexo-subencargados.md`.

| Agente | Tablas | Categorías de datos | Subencargados | Por conectar |
|---|---|---|---|---|
| Base común (flota, equipo, auditoría) | `tenant`, `app_user`, `cliente`, `unidad`, `bitacora_auditoria` | identidad_usuario, operativo, seguridad_auditoria | Supabase, Vercel, Sentry (solo errores redactados), Resend | - |
| A1 · Liquidación | `viaje`, `gasto`, `liquidacion` | financiero, fiscal, comunicaciones | Meta (WhatsApp), OpenRouter (OCR y cuadre), Supabase, Vercel | - |
| A2 · Peajes | `peaje_curso`, `peaje_regla_flota`, `peaje_aviso_enviado` | financiero, operativo | Supabase, Vercel, Resend | - |
| A3 · Carta Porte | `cp_documento`, `cp_documento_evento` | fiscal, operativo | Supabase, Vercel, PAC (proveedor de timbrado) | El PAC contratado por cada flota no está identificado en el código: depende de la configuración de la flota. |
| A4 · Vigía de servicio al cliente | `vigia_evento`, `vigia_aviso`, `vigia_dato_viaje_manual` | identidad_operador, comunicaciones, operativo | Meta (WhatsApp), Resend, Supabase, Vercel | - |
| A5 · Conductores y jornada | `operador`, `jornada_dia`, `jornada_asiento`, `posicion` | identidad_operador, jornada_laboral, ubicacion | Meta (WhatsApp), Supabase, Vercel, Proveedor de GPS de la flota | El proveedor de GPS depende del conector que la flota active; no hay uno fijo. |
