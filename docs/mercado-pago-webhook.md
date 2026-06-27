# Mercado Pago auto-access

Esta integración automatiza la activación de cursos en `public.progreso_alumnos` cuando Mercado Pago confirma un pago aprobado.

## Arquitectura

1. El alumno inicia sesión en `fitnesstrainingzone.com`.
2. En `planes.html`, el botón de pago llama a:

```text
https://yfdiejyrhaaziceyeiuc.supabase.co/functions/v1/create-payment-preference
```

3. `create-payment-preference` valida el JWT del alumno, crea una preferencia en Mercado Pago y agrega:
   - `external_reference = plan`
   - `metadata.plan = plan`
   - `metadata.user_email = email`
   - `metadata.price_option = opcion`
   - `notification_url = mercado-pago-webhook`
4. Mercado Pago redirige al alumno al checkout.
5. Cuando el pago queda aprobado, Mercado Pago llama a:

```text
https://yfdiejyrhaaziceyeiuc.supabase.co/functions/v1/mercado-pago-webhook
```

6. `mercado-pago-webhook` consulta el pago real en Mercado Pago con `MERCADO_PAGO_ACCESS_TOKEN`.
7. Solo si `payment.status === "approved"`, activa filas en `public.progreso_alumnos`.

La activación manual sigue funcionando como backup: cualquier fila cargada manualmente en `progreso_alumnos` sigue habilitando el campus.

## Funciones

### create-payment-preference

Ruta:

```text
supabase/functions/create-payment-preference/index.ts
```

Recibe:

```json
{
  "plan": "pack_completo",
  "price_option": "pago_unico",
  "email": "alumno@email.com"
}
```

Requiere header:

```text
Authorization: Bearer JWT_DEL_ALUMNO
```

Planes válidos:

```text
pack_completo
personal_trainer
nutricion
funcional_hiit
musculacion
```

Opciones válidas:

```text
pago_unico
tres_cuotas
seis_cuotas
```

No todos los planes tienen todas las opciones. Nutrición, Funcional & HIIT y Musculación solo tienen `pago_unico`.

### mercado-pago-webhook

Ruta:

```text
supabase/functions/mercado-pago-webhook/index.ts
```

Acepta payloads comunes de Mercado Pago:

```json
{ "type": "payment", "data": { "id": "123" } }
```

También soporta `id`, `resource` y query params `data.id` / `id`.

## Variables de entorno

Configurar en Supabase:

```bash
supabase secrets set MERCADO_PAGO_ACCESS_TOKEN="APP_USR_xxx"
supabase secrets set SUPABASE_URL="https://yfdiejyrhaaziceyeiuc.supabase.co"
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="ey..."
```

Opcionales:

```bash
supabase secrets set PUBLIC_SITE_URL="https://fitnesstrainingzone.com"
supabase secrets set MERCADO_PAGO_WEBHOOK_URL="https://yfdiejyrhaaziceyeiuc.supabase.co/functions/v1/mercado-pago-webhook"
```

No guardar estos valores en el repo.

## Migración SQL

Archivo:

```text
supabase/migrations/20260627000100_progreso_alumnos_auto_access.sql
```

Incluye:

```sql
alter table public.progreso_alumnos
  add column if not exists mercado_pago_payment_id text,
  add column if not exists mercado_pago_status text,
  add column if not exists plan text,
  add column if not exists activated_at timestamptz,
  add column if not exists updated_at timestamptz;

create unique index if not exists progreso_alumnos_user_email_curso_key
on public.progreso_alumnos (user_email, curso);
```

Antes de aplicar el índice, revisar duplicados:

```sql
select user_email, curso, count(*)
from public.progreso_alumnos
group by user_email, curso
having count(*) > 1;
```

Si esa consulta devuelve filas, hay que resolver duplicados antes de aplicar el índice.

## Deploy Supabase

Instalar o tener disponible Supabase CLI.

Login:

```bash
supabase login
```

Link:

```bash
supabase link --project-ref yfdiejyrhaaziceyeiuc
```

Aplicar migración:

```bash
supabase db push --project-ref yfdiejyrhaaziceyeiuc
```

Deploy funciones:

```bash
supabase functions deploy mercado-pago-webhook --project-ref yfdiejyrhaaziceyeiuc --no-verify-jwt --use-api
supabase functions deploy create-payment-preference --project-ref yfdiejyrhaaziceyeiuc --no-verify-jwt --use-api
```

Ambas funciones tienen `verify_jwt = false` en `supabase/config.toml`.

`create-payment-preference` valida manualmente el JWT del alumno con Supabase Auth.

## Mercado Pago Developers

Configurar webhook productivo:

```text
https://yfdiejyrhaaziceyeiuc.supabase.co/functions/v1/mercado-pago-webhook
```

Evento:

```text
payment / pagos
```

Los links estáticos `mpago.la` / `mpago.li` no garantizan metadata. El flujo nuevo ya no depende de que esos links tengan `external_reference`, porque `planes.html` crea una preferencia nueva desde `create-payment-preference`.

## Mapeo de planes

| Plan | Cursos activados |
| --- | --- |
| `pack_completo` | `personal`, `nutricion`, `hiit`, `musculacion` |
| `personal_trainer` | `personal` |
| `nutricion` | `nutricion` |
| `funcional_hiit` | `hiit` |
| `musculacion` | `musculacion` |

## Verificar progreso_alumnos

```sql
select *
from public.progreso_alumnos
where user_email = 'email-del-alumno@dominio.com'
order by curso;
```

Pack completo debe crear o actualizar:

```text
personal
nutricion
hiit
musculacion
```

## Pruebas

### Test A: webhook sin payment_id

```bash
curl -X POST \
  "https://yfdiejyrhaaziceyeiuc.supabase.co/functions/v1/mercado-pago-webhook" \
  -H "Content-Type: application/json" \
  -d "{}"
```

Esperado: `400` con `No se recibio payment_id`.

### Test B: webhook con payment_id falso

```bash
curl -X POST \
  "https://yfdiejyrhaaziceyeiuc.supabase.co/functions/v1/mercado-pago-webhook" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"payment\",\"data\":{\"id\":\"123456789\"}}"
```

Esperado: JSON claro con error de Mercado Pago.

### Test C: pago real aprobado

1. Crear pago desde `planes.html`.
2. Completar el pago real.
3. Revisar logs de función.
4. Revisar `progreso_alumnos`.
5. Iniciar sesión con el alumno y entrar a campus.

### Test D: pack completo

Esperado: 4 filas en `progreso_alumnos`.

### Test E: webhook duplicado

Reenviar la misma notificación desde Mercado Pago Developers.

Esperado: no se crean duplicados porque existe índice único `(user_email, curso)` y la función usa `upsert`.

### Test F: botón frontend

1. Iniciar sesión como alumno.
2. Ir a `planes.html`.
3. Click en un botón.
4. Debe crear preferencia y redirigir a Mercado Pago.

Si el alumno no inició sesión, se redirige a `login.html`.

## Logs

Ver logs en Supabase Dashboard:

```text
Project -> Edge Functions -> mercado-pago-webhook -> Logs
Project -> Edge Functions -> create-payment-preference -> Logs
```

Los logs no imprimen tokens ni service role. El webhook enmascara emails en logs operativos.

## Troubleshooting

### El alumno paga pero queda en acceso pendiente

Revisar:

1. El pago está `approved`.
2. Mercado Pago llamó al webhook.
3. El pago tiene `external_reference` o `metadata.plan`.
4. `progreso_alumnos_user_email_curso_key` existe.
5. No hay duplicados previos en `progreso_alumnos`.
6. El email de pago coincide con el email de la cuenta del alumno.

### Error de upsert

Probable causa: falta el índice único.

Ejecutar:

```sql
create unique index if not exists progreso_alumnos_user_email_curso_key
on public.progreso_alumnos (user_email, curso);
```

### Error creando preferencia

Revisar:

1. `MERCADO_PAGO_ACCESS_TOKEN` configurado.
2. La función `create-payment-preference` desplegada.
3. El alumno está logueado y envía JWT.
4. El plan y `price_option` son válidos.

### Cuotas sin interés

La preferencia define monto y máximo de cuotas según el botón. La condición real de "sin interés" depende de la configuración comercial de Mercado Pago para la cuenta vendedora.
