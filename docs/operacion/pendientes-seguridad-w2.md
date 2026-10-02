# Seguridad, datos y legal — lo que cerró el stream W2 y lo que queda (1-oct-2026)

Rama: `loop/w2-seguridad` (commits locales; sin push). Migraciones 0440–0443.
Hallazgos de origen: `~/likida-loop/hallazgos-ola1.json` (números entre paréntesis).

## Aplicar a la base real (requiere autorización de Javier)

Orden: 0440, 0441, 0442, 0443 (independientes entre sí; todas idempotentes) y DESPUÉS un commit
`[deploy]` (la compuerta `compuerta-deploy.mjs` no construye si la base va atrás).

| Mig. | Qué hace | Efecto visible al aplicarla |
|---|---|---|
| 0440 | `mcp_oauth_cliente.estado` (pendiente/aprobado/rechazado) | Los clientes MCP ya registrados con host de Claude/ChatGPT/OpenAI o loopback quedan `aprobado`; **cualquier otro queda `pendiente`: su refresco deja de rotar hasta que el superadmin lo apruebe en `/admin/mcp-clientes`** |
| 0441 | índice `(tenant_id, run_id)` en `llm_presupuesto_reserva` y `mantener_llm_presupuesto` | `reservar_presupuesto_llm` deja de recorrer el historial; la purga la llama `/api/cron/purgar` |
| 0442 | `solicitud_arco.titular_user_id` y la cancelación ARCO de cuentas de oficina | Dueño/contador/encargado pueden ejercer cancelación por WhatsApp y el panel la ejecuta |
| 0443 | `aceptacion_legal` | **La emisión de CFDI por portales exige además el mandato vigente de la flota** (`/dashboard/legal`); sin él, ensayo |

SQL contra Postgres real: `supabase/tests/0440_*.sql … 0443_*.sql` (ya enganchados en `ci-postgres.yml`).
Corridos localmente contra PG 17 con todas las migraciones aplicadas en orden sobre una base virgen.

## Bloqueos externos (no se pueden cerrar por código)

1. **Purga de historial** (0, 1): `~/likida-loop/runbook-purga-historial.md`. El árbol ya no rastrea
   `staging_canacar/` ni `docs/auditoria-*/` (prueba `sin_datos_privados_rastreados.test.ts`); el historial público
   sigue conteniéndolos hasta el `git filter-repo` + force-push, que decide Javier.
2. **CVE de `next` (42)**: `next` 16.3.5 con GHSA-vcvr-r3jv-pc5j (crítico, rango >=16.2.0 <16.3.6) y `brace-expansion`
   (3 GHSA, high). No se tocó `package.json` (exige `npm install` y disco). Procedimiento:
   ```bash
   cd ~/likida && git switch -c deps/next-16.3.6
   npm install next@16.3.6 --save-exact           # o fusionar el PR #492 de Dependabot
   # overrides para brace-expansion y fast-uri en package.json ("overrides": {...}) con las versiones parcheadas de `npm audit`
   npm audit --omit=dev && npm run typecheck && npx vitest run src/app src/lib/mcp
   ```
   `grep -rn "next/og\|ImageResponse" src/` da 0: la alcanzabilidad real del RCE es probablemente baja, pero el gate de CI está rojo.
   Habilitar además Dependabot alerts/security updates en el repo público (Settings → Code security; gratis).
3. **Protección de la rama `master` (43)**: configuración externa de GitHub. Comando a ejecutar por Javier:
   ```bash
   R=$(gh repo view --json nameWithOwner -q .nameWithOwner)
   gh api -X PUT "repos/$R/branches/master/protection" --input - <<'JSON'
   {
     "required_status_checks": { "strict": true,
       "contexts": ["Verificar (typecheck, lint, pruebas, build)", "Migraciones + aislamiento (Postgres efímero)"] },
     "enforce_admins": false,
     "required_pull_request_reviews": null,
     "restrictions": null,
     "allow_force_pushes": false,
     "allow_deletions": false
   }
   JSON
   ```
   `enforce_admins:false` a propósito: la política de contribuciones de Javier empuja commits directo a la rama default;
   con `true` quedaría bloqueado. Con `false` la protección frena a bots y a PRs sin checks, y Javier conserva su flujo.
   Antes de activarla, confirma que `auto-merge-rutina.yml` no usa squash (se quieren commits atómicos). Para la purga de
   historial hay que permitir force-push temporalmente.
4. **HIBP en Supabase Auth (5)**: Auth → Passwords → «Leaked password protection». Cambio externo; no se hizo.
5. **Meta**: renovar `WHATSAPP_ACCESS_TOKEN` con un token de USUARIO DEL SISTEMA permanente (el aviso del token vencido
   lo detecta, pero no lo renueva). `gps_alerta_critica` sigue pendiente de aprobar/verificar su texto en Meta; ya no manda
   saltos de línea (132018).
6. **Términos (47)**: los marcadores 🔴 de precios/SLA y los anexos (DPA, SLA, seguridad, subencargados) requieren
   abogado y decisión comercial; `/dashboard/legal` solo registra la aceptación, no sustituye la revisión del texto del mandato.
7. **Respaldos (44), producción atrás de master (41), monitoreo externo (50)**: operaciones/configuración externa.

## Lo que NO se construyó (y por qué)

- **Cancelación de CFDI de Carta Porte por API del PAC (26)**: `pac/sw.ts` sigue devolviendo «cancela en el panel del PAC».
  Implementarla exige el contrato real de cancelación de SW Sapien (motivos 01–04, folio de sustitución, uso del CSD) que NO
  se pudo verificar desde aquí, y no se inventan endpoints. Tampoco hay conciliación automática de la reserva `pendiente`
  contra el PAC (requiere la consulta por UUID). Lo que sí quedó: `liberarReservaTimbre` + botón en `/dashboard/timbrado/<viaje>`
  (solo sin UUID, tras 30 min, el humano declara haber verificado en el panel del PAC; bitácora) y `maxDuration = 60` en la ruta.
- **Clasificación del 602 (7)**: solo cambió el TEXTO («no se pudo confirmar»). `cfdi_no_encontrado` sigue en
  `NO_DEDUCIBLE_ISR`/`SIN_IVA_ACREDITABLE`; si el criterio P36 del fiscalista pide «por confirmar» (ni deducible ni acreditable,
  como `cfdi_efos_indeterminado`), es un cambio de dinero que debe decidir el fiscalista.
- **Techo de IA por flota con pantalla (17)**: *cerrado en la Ola 9* (`/admin/techo-ia`, mig. 0682).
- **CSP con nonce (4)**, retención de ledgers (22) y flood de `evento_seguridad` (19): *cerrados en la Ola 9* (ver «Ola 9» abajo).
  Siguen fuera de alcance: `/api/health` público con la lista de migraciones (57), retención de `jornada_*` (53, decisión legal) y
  costo de WhatsApp fuera de la liquidación (20).

## Qué cambia para operación

- `/admin/mcp-clientes`: cola de aprobación de clientes MCP desconocidos (aprobar solo dominios que se reconocen).
- `/dashboard/legal` (solo dueño): aceptar Términos y Aviso vigentes, otorgar/retirar el mandato de autofacturación,
  capturar razón social / domicilio / contacto de privacidad de la flota. Hasta que se capture, el aviso del chofer
  **sale igual** con esos datos dichos como pendientes.
- Subir `VERSION_TERMINOS`/`VERSION_AVISO_PRIVACIDAD` (en `src/lib/legal/documentos.ts`) cuando cambie el texto; cambiar el texto
  del mandato exige subir su versión y su huella (la prueba lo obliga) y retira el mandato de todas las flotas.

## Ola 9 (2-oct-2026) — rama `loop/w4-ola9-seguridad`, migraciones 0680–0682

| Mig. | Qué hace | Efecto al aplicarla |
|---|---|---|
| 0680 | `purgar_evento_seguridad` (info 90 / media 180 / alta 365) y `mantener_ledgers` (+ `evento_stripe` 400, `vigia_evento` 365, `cp_documento_evento` 730, `buzon_entrega_evento` 365) | La primera corrida de `/api/cron/purgar` tras aplicarla borra el histórico vencido (en tandas, con deadline); las purgas que fallan se avisan, no tumban el cron |
| 0681 | `evento_seguridad.repeticiones/ultimo_en/clave` y la RPC `registrar_evento_seguridad` | Los webhooks dejan de abrir una fila por petición: misma señal en su ventana = una fila con conteo; tope de filas distintas con fila de desborde. Lo `alta` nunca se descarta. Con código adelante de la migración cae al insert directo |
| 0682 | `fijar_techo_ia_tenant` | La pantalla `/admin/techo-ia` fija/quita `tenant.config.presupuestoLlmUsdDia` (rango 0.10–1000) con `jsonb_set` atómico |

- **CSP con nonce**: `docs/operacion/csp.md`. Rutas con sesión; públicas sin cambio; reversa con `LIKIDA_CSP_NONCE=0`. **Sin `next build` ni navegador en esta ronda: verificar antes de producción.**
- **`purgar_autofactura` (0542)** ya cuelga de `/api/cron/purgar` (módulo `retencion_ledgers.ts`).
- **Hallazgos 28–30**: `docs/operacion/hallazgos-ola1-agentes-28-30.md`.
- **Bump de `next` (CVE GHSA-vcvr-r3jv-pc5j) — NO hecho, requiere autorización de Javier** (`package.json` intacto). Primera versión parcheada: 16.3.6; la
  última estable al 2-oct-2026 es 16.3.8. Diff exacto:
  ```diff
  -    "next": "^16.3.5",
  +    "next": "^16.3.8",
  ...
  -    "eslint-config-next": "^16.3.5",
  +    "eslint-config-next": "^16.3.8",
  ```
  y luego `npm install` (regenera `package-lock.json`), `npm audit --omit=dev`, typecheck y la suite. El CSP con nonce usa solo APIs estables de Next 16
  (`proxy.ts` y el header CSP de la petición), no depende del parche.
