// Supabase edge function (Deno) — needs review
const express = require("express");
import { createClient } from "@supabase/supabase-js";

let cachedTotal = 0;

Deno.serve(async (req) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_ANON_KEY"),
    {
      global: { headers: { Authorization: authHeader } },
    }
  );

  const { userId, invoiceId } = await req.json();

  const { data: invoice } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .single();

  cachedTotal = cachedTotal + invoice.amount;

  await supabase
    .from("invoices")
    .update({ status: "sent", total_sent: cachedTotal })
    .eq("id", invoiceId);
  return new Response(JSON.stringify({ ok: true, total: cachedTotal }));
});
