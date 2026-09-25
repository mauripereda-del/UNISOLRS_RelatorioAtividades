/**
 * Verificações estáticas pré-produção.
 * Não faz deploy, não altera arquivos e não imprime segredos.
 */
const fs = require("fs");
const path = require("path");

const raiz = path.resolve(__dirname, "..");
const erros = [];
const avisos = [];

const ESSENCIAIS = [
  "package.json",
  "package-lock.json",
  "vercel.json",
  ".gitignore",
  ".vercelignore",
  ".env.example",
  "js/env.example.js",
  "js/config.js",
  "js/supabase.js",
  "js/guards.js",
  "js/vendor/docx.mjs",
  "assets/images/logounisol.png",
  "index.html",
  "pages/dashboard.html",
  "pages/nova-atividade.html",
  "pages/historico.html",
  "pages/visualizar-atividade.html",
  "pages/solicitacoes-reabertura.html",
  "pages/relatorio-mensal.html",
  "pages/usuarios.html",
  "pages/visualizar-usuario.html",
  "pages/meu-perfil.html",
  "pages/recuperar-senha.html",
  "pages/redefinir-senha.html",
  "supabase/functions/admin-usuarios/index.ts",
  "sql/001_initial_schema.sql",
  "sql/002_rls_policies.sql",
  "sql/003_atividades.sql",
  "sql/004_atividade_fotos_storage.sql",
  "sql/006_reabertura_auditoria.sql",
  "sql/006_1_ajustes_reabertura.sql",
  "sql/007_cancelamento_auditoria.sql",
  "sql/010_administracao_usuarios.sql",
];

const PUBLICOS = [
  "index.html",
  "package.json",
  "vercel.json",
  ".env.example",
  "js/env.example.js",
  "scripts/gerar-env.js",
];

const PAGINAS_HTML = [
  "index.html",
  "pages/dashboard.html",
  "pages/nova-atividade.html",
  "pages/historico.html",
  "pages/visualizar-atividade.html",
  "pages/solicitacoes-reabertura.html",
  "pages/relatorio-mensal.html",
  "pages/usuarios.html",
  "pages/visualizar-usuario.html",
  "pages/meu-perfil.html",
  "pages/recuperar-senha.html",
  "pages/redefinir-senha.html",
];

function ler(relativo) {
  return fs.readFileSync(path.join(raiz, relativo), "utf8");
}

function existe(relativo) {
  return fs.existsSync(path.join(raiz, relativo));
}

function papelJwt(chave) {
  try {
    const payload = String(chave || "").split(".")[1];
    if (!payload) {
      return "";
    }
    return String(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).role || "");
  } catch (_erro) {
    return "";
  }
}

function varrerJsPublico(callback) {
  const fila = [path.join(raiz, "js"), path.join(raiz, "pages"), path.join(raiz, "index.html")];

  while (fila.length) {
    const atual = fila.pop();
    const stat = fs.statSync(atual);
    if (stat.isDirectory()) {
      if (path.basename(atual) === "vendor") {
        continue;
      }
      fs.readdirSync(atual).forEach((nome) => fila.push(path.join(atual, nome)));
      continue;
    }

    if (!/\.(js|html|css)$/.test(atual) || atual.endsWith("docx.mjs")) {
      continue;
    }

    callback(path.relative(raiz, atual).replace(/\\/g, "/"), fs.readFileSync(atual, "utf8"));
  }
}

ESSENCIAIS.forEach((arquivo) => {
  if (!existe(arquivo)) {
    erros.push(`Arquivo essencial ausente: ${arquivo}`);
  }
});

["sql/005_placeholder.sql", "sql/008_placeholder.sql", "sql/009_placeholder.sql"].forEach((arquivo) => {
  if (existe(arquivo.replace("_placeholder", ""))) {
    avisos.push(`SQL inesperado encontrado: ${arquivo.replace("_placeholder", "")}`);
  }
});

if (existe("package.json")) {
  const pkg = JSON.parse(ler("package.json"));
  if (!pkg.scripts?.build || !pkg.scripts?.predeployCheck && !pkg.scripts?.["predeploy-check"]) {
    if (!pkg.scripts?.["predeploy-check"]) {
      erros.push("package.json sem script predeploy-check.");
    }
  }
  if (!pkg.scripts?.build) {
    erros.push("package.json sem script build.");
  }
}

if (existe("vercel.json")) {
  const vercel = JSON.parse(ler("vercel.json"));
  if (vercel.framework !== null) {
    erros.push("vercel.json.framework deve ser null.");
  }
  if (vercel.buildCommand !== "npm run build") {
    erros.push("vercel.json.buildCommand deve ser npm run build.");
  }
  if (vercel.cleanUrls !== true) {
    erros.push("vercel.json.cleanUrls deve ser true.");
  }
  const headers = JSON.stringify(vercel.headers || []);
  if (!headers.includes("X-Content-Type-Options") || !headers.includes("nosniff")) {
    erros.push("vercel.json sem X-Content-Type-Options: nosniff.");
  }
}

if (existe(".gitignore")) {
  const ignore = ler(".gitignore");
  if (!ignore.includes("js/env.js")) {
    erros.push(".gitignore não ignora js/env.js.");
  }
  if (!ignore.includes(".env")) {
    erros.push(".gitignore não ignora .env.");
  }
}

if (existe(".env.example")) {
  const exemplo = ler(".env.example");
  if (/^SUPABASE_SERVICE_ROLE_KEY\s*=/m.test(exemplo)) {
    erros.push(".env.example declara SUPABASE_SERVICE_ROLE_KEY.");
  }
  if (!exemplo.includes("SUPABASE_URL") || !exemplo.includes("SUPABASE_ANON_KEY")) {
    erros.push(".env.example deve documentar SUPABASE_URL e SUPABASE_ANON_KEY.");
  }
}

if (existe("js/env.example.js")) {
  const exemploJs = ler("js/env.example.js");
  if (papelJwt((exemploJs.match(/SUPABASE_ANON_KEY:\s*"([^"]+)"/) || [])[1]) === "service_role") {
    erros.push("js/env.example.js contém chave service_role.");
  }
}

PUBLICOS.forEach((arquivo) => {
  if (!existe(arquivo)) {
    return;
  }
  const texto = ler(arquivo);
  if (/SUPABASE_SERVICE_ROLE_KEY\s*[:=]/.test(texto) && !texto.includes("Nunca")) {
    erros.push(`${arquivo} atribui SUPABASE_SERVICE_ROLE_KEY.`);
  }
});

varrerJsPublico((arquivo, texto) => {
  if (/Deno\.env\.get\(\s*["']SUPABASE_SERVICE_ROLE_KEY["']/.test(texto)) {
    erros.push(`${arquivo} lê service_role no frontend.`);
  }
  if (/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(texto) && arquivo !== "js/env.example.js") {
    const match = texto.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    if (match && papelJwt(match[0]) === "service_role") {
      erros.push(`${arquivo} contém JWT service_role.`);
    }
  }
});

function resolverCaminhoPagina(pagina, referencia) {
  const limpo = String(referencia || "").split("?")[0];
  if (!limpo || limpo.startsWith("#") || limpo.startsWith("http") || limpo.startsWith("mailto:")) {
    return null;
  }

  if (limpo.startsWith("/")) {
    return path.normalize(path.join(raiz, limpo.slice(1)));
  }

  return path.normalize(path.join(path.dirname(path.join(raiz, pagina)), limpo));
}

PAGINAS_HTML.forEach((pagina) => {
  if (!existe(pagina)) {
    return;
  }
  const html = ler(pagina);
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((item) => item[1]);
  hrefs.forEach((href) => {
    const alvo = resolverCaminhoPagina(pagina, href);
    if (alvo && !fs.existsSync(alvo)) {
      erros.push(`Link quebrado em ${pagina}: ${href}`);
    }
  });

  const srcs = [...html.matchAll(/src="([^"]+)"/g)].map((item) => item[1]);
  srcs.forEach((src) => {
    const alvo = resolverCaminhoPagina(pagina, src);
    if (alvo && !fs.existsSync(alvo)) {
      erros.push(`Import/asset quebrado em ${pagina}: ${src}`);
    }
  });
});

if (existe("assets/images")) {
  const logos = fs
    .readdirSync(path.join(raiz, "assets/images"))
    .filter((nome) => nome.toLowerCase() === "logounisol.png");
  if (logos.length > 1) {
    avisos.push("Há duas grafias do logo; Linux diferencia maiúsculas.");
  }
}

console.log("predeploy-check: verificações estáticas concluídas.");
if (avisos.length) {
  avisos.forEach((item) => console.warn(`AVISO  ${item}`));
}
if (erros.length) {
  erros.forEach((item) => console.error(`ERRO   ${item}`));
  process.exit(1);
}

console.log("predeploy-check: ok.");
