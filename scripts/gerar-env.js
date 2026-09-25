/**
 * Gera js/env.js a partir das variáveis de ambiente do sistema.
 * Usado no build da Vercel. Localmente, prefira copiar js/env.example.js.
 */
const fs = require("fs");
const path = require("path");

const supabaseUrl = String(process.env.SUPABASE_URL || "").trim();
const supabaseAnonKey = String(process.env.SUPABASE_ANON_KEY || "").trim();

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("SUPABASE_URL e SUPABASE_ANON_KEY são obrigatórias para gerar js/env.js.");
  process.exit(1);
}

function papelDaChave(chave) {
  try {
    const payload = chave.split(".")[1];
    if (!payload) {
      return "";
    }
    const json = Buffer.from(payload, "base64url").toString("utf8");
    return String(JSON.parse(json).role || "");
  } catch (_erro) {
    return "";
  }
}

if (papelDaChave(supabaseAnonKey) === "service_role") {
  console.error("A variável SUPABASE_ANON_KEY não pode ser uma chave service_role.");
  process.exit(1);
}

const destino = path.join(__dirname, "..", "js", "env.js");
const conteudo = `window.__UNISOL_ENV__ = {
  SUPABASE_URL: ${JSON.stringify(supabaseUrl)},
  SUPABASE_ANON_KEY: ${JSON.stringify(supabaseAnonKey)},
};
`;

fs.writeFileSync(destino, conteudo, "utf8");
console.log("js/env.js gerado com as variáveis públicas do Supabase.");
