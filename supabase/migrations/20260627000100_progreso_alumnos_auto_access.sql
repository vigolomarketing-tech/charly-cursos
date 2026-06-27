-- Automatic Mercado Pago access activation support.
-- Non-destructive: only adds optional tracking columns when missing and
-- creates the unique index required by Edge Function upserts.

alter table public.progreso_alumnos
  add column if not exists mercado_pago_payment_id text,
  add column if not exists mercado_pago_status text,
  add column if not exists plan text,
  add column if not exists activated_at timestamptz,
  add column if not exists updated_at timestamptz;

create unique index if not exists progreso_alumnos_user_email_curso_key
on public.progreso_alumnos (user_email, curso);
