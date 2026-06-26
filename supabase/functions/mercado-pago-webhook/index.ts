import { createClient } from "npm:@supabase/supabase-js@2";

const ACCESS_TOKEN = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const COURSES_BY_PLAN = {
  pack_completo: ["personal", "nutricion", "hiit", "musculacion"],
  completo: ["personal", "nutricion", "hiit", "musculacion"],
  personal_trainer: ["personal"],
  personal: ["personal"],
  nutricion: ["nutricion"],
  funcional_hiit: ["hiit"],
  hiit: ["hiit"],
  musculacion: ["musculacion"],
};

const PLAN_ALIASES = {
  "pack completo": "pack_completo",
  "pack_completo": "pack_completo",
  "completo": "pack_completo",
  "personal trainer": "personal_trainer",
  "personal_trainer": "personal_trainer",
  "personal": "personal_trainer",
  "nutricion": "nutricion",
  "nutrición": "nutricion",
  "funcional hiit": "funcional_hiit",
  "funcional_hiit": "funcional_hiit",
  "funcional & hiit": "funcional_hiit",
  "hiit": "funcional_hiit",
  "musculacion": "musculacion",
  "musculación": "musculacion",
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    },
  });
}

function normalizePlan(value) {
  if (!value) return null;
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (COURSES_BY_PLAN[normalized]) return normalized;
  if (normalized.includes("pack_completo") || normalized.includes("completo")) return "pack_completo";
  if (normalized.includes("personal_trainer")) return "personal_trainer";
  if (normalized.includes("nutricion")) return "nutricion";
  if (normalized.includes("funcional") || normalized.includes("hiit")) return "funcional_hiit";
  if (normalized.includes("musculacion")) return "musculacion";

  return PLAN_ALIASES[normalized] || null;
}

function extractPaymentId(value) {
  if (!value) return null;
  const text = String(value);
  const urlMatch = text.match(/payments\/(\d+)/);
  if (urlMatch) return urlMatch[1];
  const numberMatch = text.match(/^(\d+)$/);
  return numberMatch ? numberMatch[1] : text;
}

function readPaymentId(payload, url) {
  const paymentId = payload?.data?.id
    || payload?.id
    || payload?.resource
    || url.searchParams.get("data.id")
    || url.searchParams.get("id");

  return extractPaymentId(paymentId);
}

function readNotificationType(payload, url) {
  return payload?.type
    || payload?.topic
    || url.searchParams.get("type")
    || url.searchParams.get("topic");
}

function readPlanFromPayment(payment) {
  const metadata = payment?.metadata || {};
  const candidates = [
    payment?.external_reference,
    metadata?.plan,
    metadata?.curso,
    metadata?.course,
    metadata?.external_reference,
    payment?.description,
    ...(payment?.additional_info?.items || []).flatMap((item) => [
      item?.id,
      item?.title,
      item?.description,
    ]),
  ];

  for (const candidate of candidates) {
    const plan = normalizePlan(candidate);
    if (plan) return plan;
  }

  return null;
}

async function fetchPayment(paymentId) {
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
    },
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.message || `Mercado Pago respondio ${response.status}`);
  }

  return data;
}

function buildAccessRows(email, plan) {
  const cursos = COURSES_BY_PLAN[plan];
  if (!cursos) return [];

  const now = new Date().toISOString();
  return cursos.map((curso) => ({
    user_email: email.toLowerCase(),
    curso,
    clase_actual: 1,
    updated_at: now,
  }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Metodo no permitido" }, 405);
  }

  if (!ACCESS_TOKEN || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse({
      ok: false,
      error: "Faltan variables de entorno requeridas",
    }, 500);
  }

  const url = new URL(req.url);
  const payload = await req.json().catch(() => ({}));
  const notificationType = readNotificationType(payload, url);

  if (notificationType && notificationType !== "payment") {
    return jsonResponse({
      ok: true,
      ignored: true,
      reason: `Notificacion ignorada: ${notificationType}`,
    });
  }

  const paymentId = readPaymentId(payload, url);
  if (!paymentId) {
    return jsonResponse({
      ok: false,
      error: "No se recibio payment_id",
    }, 400);
  }

  try {
    const payment = await fetchPayment(paymentId);

    if (payment.status !== "approved") {
      return jsonResponse({
        ok: true,
        ignored: true,
        payment_id: paymentId,
        status: payment.status,
      });
    }

    const email = payment?.payer?.email;
    if (!email) {
      return jsonResponse({
        ok: false,
        payment_id: paymentId,
        error: "El pago aprobado no tiene payer.email",
      }, 422);
    }

    const plan = readPlanFromPayment(payment);
    if (!plan) {
      return jsonResponse({
        ok: false,
        payment_id: paymentId,
        error: "No se pudo identificar el plan desde external_reference o metadata",
      }, 422);
    }

    const rows = buildAccessRows(email, plan);
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { error } = await supabase
      .from("progreso_alumnos")
      .upsert(rows, {
        onConflict: "user_email,curso",
        ignoreDuplicates: true,
      });

    if (error) throw error;

    return jsonResponse({
      ok: true,
      payment_id: paymentId,
      email: email.toLowerCase(),
      plan,
      cursos_activados: rows.map((row) => row.curso),
    });
  } catch (error) {
    console.error("Error procesando webhook Mercado Pago", error);
    return jsonResponse({
      ok: false,
      payment_id: paymentId,
      error: error?.message || "Error desconocido",
    }, 500);
  }
});
