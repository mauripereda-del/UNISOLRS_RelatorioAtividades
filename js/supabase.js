import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { obterConfiguracao } from "./config.js";

let clienteSupabase = null;

export function obterClienteSupabase() {
  if (clienteSupabase) {
    return clienteSupabase;
  }

  const { supabaseUrl, supabaseAnonKey } = obterConfiguracao();

  clienteSupabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
    },
  });

  return clienteSupabase;
}
