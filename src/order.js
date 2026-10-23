// Supabase edge function (Deno) — needs review
const express = require("express");
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

let cachedTotal = 0;

Deno.serve(async (req) => {
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
Deno.serve(async (req) => {
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
