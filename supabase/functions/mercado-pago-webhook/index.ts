import { createClient } from "npm:@supabase/supabase-js@2";

type JsonRecord = Record<string, unknown>;
type PlanCode = "pack_completo" | "personal_trainer" | "nutricion" | "funcional_hiit" | "musculacion";
type CourseCode = "personal" | "nutricion" | "hiit" | "musculacion";
type OptionalColumn =
  | "clase_actual"
  | "updated_at"
  | "activated_at"
  | "mercado_pago_payment_id"
  | "mercado_pago_status"
  | "plan";

const ACCESS_TOKEN = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const COURSES_BY_PLAN: Record<PlanCode | "completo" | "personal" | "hiit", CourseCode[]> = {
  pack_completo: ["personal", "nutricion", "hiit", "musculacion"],
  completo: ["personal", "nutricion", "hiit", "musculacion"],
  personal_trainer: ["personal"],
  personal: ["personal"],
  nutricion: ["nutricion"],
  funcional_hiit: ["hiit"],
  hiit: ["hiit"],
  musculacion: ["musculacion"],
};

const OPTIONAL_COLUMNS: OptionalColumn[] = [
  "clase_actual",
  "updated_at",
  "activated_at",
  "mercado_pago_payment_id",
  "mercado_pago_status",
  "plan",
];

function jsonResponse(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    },
  });
}

function normalizePlan(value: unknown): PlanCode | null {
  if (!value) return null;

  const normalized = String(value)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (normalized.includes("pack_completo") || normalized.includes("completo")) return "pack_completo";
  if (normalized.includes("personal_trainer") || normalized === "personal") return "personal_trainer";
  if (normalized.includes("nutricion")) return "nutricion";
  if (normalized.includes("funcional") || normalized.includes("hiit")) return "funcional_hiit";
  if (normalized.includes("musculacion")) return "musculacion";

  return null;
}

function extractPaymentId(value: unknown): string | null {
  if (!value) return null;
  const text = String(value);
  const urlMatch = text.match(/payments\/(\d+)/);
  if (urlMatch) return urlMatch[1];
  const numberMatch = text.match(/^(\d+)$/);
  return numberMatch ? numberMatch[1] : text;
}

function readPaymentId(payload: JsonRecord, url: URL): string | null {
  const data = payload.data as JsonRecord | undefined;
  const paymentId = data?.id
    || payload.id
    || payload.resource
    || url.searchParams.get("data.id")
    || url.searchParams.get("id");

  return extractPaymentId(paymentId);
}

function readNotificationType(payload: JsonRecord, url: URL): string | null {
  return String(
    payload.type
      || payload.topic
      || url.searchParams.get("type")
      || url.searchParams.get("topic")
      || "",
  ) || null;
}

function readPlanFromPayment(payment: JsonRecord): PlanCode | null {
  const metadata = (payment.metadata || {}) as JsonRecord;
  const additionalInfo = (payment.additional_info || {}) as JsonRecord;
  const items = Array.isArray(additionalInfo.items) ? additionalInfo.items as JsonRecord[] : [];
  const candidates = [
    payment.external_reference,
    metadata.plan,
    metadata.curso,
    metadata.course,
    metadata.external_reference,
    payment.description,
    ...items.flatMap((item) => [item.id, item.title, item.description]),
  ];

  for (const candidate of candidates) {
    const plan = normalizePlan(candidate);
    if (plan) return plan;
  }

  return null;
}

function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!domain) return "***";
  const visible = name.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(name.length - 2, 1))}@${domain}`;
}

async function fetchPayment(paymentId: string): Promise<JsonRecord> {
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
    },
  });

  const data = await response.json().catch(() => null) as JsonRecord | null;

  if (!response.ok) {
    throw new Error(String(data?.message || `Mercado Pago respondio ${response.status}`));
  }

  return data || {};
}

async function detectColumns(supabase: ReturnType<typeof createClient>): Promise<Set<OptionalColumn>> {
  const checks = await Promise.all(OPTIONAL_COLUMNS.map(async (column) => {
    const { error } = await supabase
      .from("progreso_alumnos")
      .select(column)
      .limit(1);

    return [column, !error] as const;
  }));

  return new Set(checks.filter(([, exists]) => exists).map(([column]) => column));
}

async function readExistingRows(
  supabase: ReturnType<typeof createClient>,
  email: string,
  cursos: CourseCode[],
  availableColumns: Set<OptionalColumn>,
): Promise<Map<CourseCode, JsonRecord>> {
  const columns = ["curso"];
  if (availableColumns.has("clase_actual")) columns.push("clase_actual");
  if (availableColumns.has("activated_at")) columns.push("activated_at");

  const { data, error } = await supabase
    .from("progreso_alumnos")
    .select(columns.join(","))
    .eq("user_email", email)
    .in("curso", cursos);

  if (error) throw error;

  return new Map((data || []).map((row: JsonRecord) => [row.curso as CourseCode, row]));
}

function buildAccessRows(
  email: string,
  plan: PlanCode,
  payment: JsonRecord,
  availableColumns: Set<OptionalColumn>,
  existingRows: Map<CourseCode, JsonRecord>,
): JsonRecord[] {
  const cursos = COURSES_BY_PLAN[plan];
  const now = new Date().toISOString();

  return cursos.map((curso) => {
    const existing = existingRows.get(curso) || {};
    const row: JsonRecord = {
      user_email: email.toLowerCase(),
      curso,
    };

    if (availableColumns.has("clase_actual")) row.clase_actual = existing.clase_actual || 1;
    if (availableColumns.has("updated_at")) row.updated_at = now;
    if (availableColumns.has("activated_at")) row.activated_at = existing.activated_at || now;
    if (availableColumns.has("mercado_pago_payment_id")) row.mercado_pago_payment_id = String(payment.id || "");
    if (availableColumns.has("mercado_pago_status")) row.mercado_pago_status = String(payment.status || "");
    if (availableColumns.has("plan")) row.plan = plan;

    return row;
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Metodo no permitido" }, 405);
  }

  if (!ACCESS_TOKEN || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse({ ok: false, error: "Faltan variables de entorno requeridas" }, 500);
  }

  const url = new URL(req.url);
  const payload = await req.json().catch(() => ({})) as JsonRecord;
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
    return jsonResponse({ ok: false, error: "No se recibio payment_id" }, 400);
  }

  try {
    const payment = await fetchPayment(paymentId);

    if (payment.status !== "approved") {
      console.info("Pago ignorado por estado no aprobado", {
        payment_id: paymentId,
        status: payment.status,
      });
      return jsonResponse({
        ok: true,
        ignored: true,
        payment_id: paymentId,
        status: String(payment.status || ""),
      });
    }

    const payer = (payment.payer || {}) as JsonRecord;
    const email = String(payer.email || "").toLowerCase();
    if (!email) {
      return jsonResponse({
        ok: false,
        payment_id: paymentId,
        error: "El pago aprobado no tiene payer.email",
      }, 422);
    }

    const plan = readPlanFromPayment(payment);
    if (!plan) {
      console.warn("Pago aprobado sin plan identificable", {
        payment_id: paymentId,
        payer: maskEmail(email),
        external_reference: payment.external_reference || null,
        metadata: payment.metadata || null,
      });
      return jsonResponse({
        ok: false,
        payment_id: paymentId,
        error: "No se pudo identificar el plan desde external_reference o metadata",
      }, 422);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const availableColumns = await detectColumns(supabase);
    const cursos = COURSES_BY_PLAN[plan];
    const existingRows = await readExistingRows(supabase, email, cursos, availableColumns);
    const rows = buildAccessRows(email, plan, payment, availableColumns, existingRows);

    const { error } = await supabase
      .from("progreso_alumnos")
      .upsert(rows, {
        onConflict: "user_email,curso",
      });

    if (error) throw error;

    console.info("Acceso Mercado Pago activado", {
      payment_id: paymentId,
      payer: maskEmail(email),
      plan,
      cursos,
    });

    return jsonResponse({
      ok: true,
      payment_id: paymentId,
      email,
      plan,
      cursos_activados: cursos,
    });
  } catch (error) {
    console.error("Error procesando webhook Mercado Pago", {
      payment_id: paymentId,
      message: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse({
      ok: false,
      payment_id: paymentId,
      error: error instanceof Error ? error.message : "Error desconocido",
    }, 500);
  }
});
