import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const ACOES = new Set(["CRIAR_USUARIO", "ALTERAR_EMAIL", "ENVIAR_RECUPERACAO"]);
const PERFIS = new Set(["ADMIN", "MOBILIZADOR"]);
const STATUS = new Set(["ATIVO", "INATIVO"]);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Json = Record<string, unknown>;

function origemPermitida(origem: string): boolean {
  if (!origem) {
    return false;
  }

  try {
    const url = new URL(origem);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }

    const host = url.hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.endsWith(".vercel.app")
    );
  } catch {
    return false;
  }
}

function cabecalhosCors(req: Request): HeadersInit {
  const origem = req.headers.get("Origin") || "";
  const permitido = origemPermitida(origem) ? origem : "";

  return {
    "Access-Control-Allow-Origin": permitido,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function responder(req: Request, status: number, corpo: Json) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: {
      ...cabecalhosCors(req),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function normalizarEmail(valor: unknown): string {
  return String(valor || "").trim().toLowerCase();
}

function normalizarNome(valor: unknown): string {
  return String(valor || "").replace(/\s+/g, " ").trim();
}

function normalizarTelefone(valor: unknown): string | null {
  const texto = String(valor || "").trim();
  return texto || null;
}

function telefoneValido(valor: string | null): boolean {
  if (!valor) {
    return true;
  }

  if (!/^[0-9+()\s-]{8,20}$/.test(valor)) {
    return false;
  }

  const digitos = valor.replace(/\D/g, "");
  return digitos.length >= 10 && digitos.length <= 13;
}

function validarRedirect(valor: unknown, origem: string): string | null {
  const texto = String(valor || "").trim();
  if (!texto) {
    return null;
  }

  try {
    const url = new URL(texto);
    if (!url.pathname.endsWith("/pages/redefinir-senha.html")) {
      return null;
    }

    if (origemPermitida(url.origin) || (origem && url.origin === origem)) {
      return url.toString();
    }

    return null;
  } catch {
    return null;
  }
}

function senhaTemporaria(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (item) => item.toString(16).padStart(2, "0")).join("");
}

async function obterAdminAtivo(
  req: Request,
  admin: SupabaseClient,
): Promise<{ id: string } | Response> {
  const autorizacao = req.headers.get("Authorization") || "";
  const jwt = autorizacao.replace(/^Bearer\s+/i, "").trim();

  if (!jwt) {
    return responder(req, 401, { erro: "Sessão inválida ou expirada.", codigo: "NAO_AUTENTICADO" });
  }

  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user?.id) {
    return responder(req, 401, { erro: "Sessão inválida ou expirada.", codigo: "NAO_AUTENTICADO" });
  }

  const { data: perfil, error: erroPerfil } = await admin
    .from("profiles")
    .select("id, perfil, status")
    .eq("id", data.user.id)
    .maybeSingle();

  if (erroPerfil || !perfil || perfil.perfil !== "ADMIN" || perfil.status !== "ATIVO") {
    return responder(req, 403, { erro: "Acesso não autorizado.", codigo: "PROIBIDO" });
  }

  return { id: data.user.id };
}

async function auditar(
  admin: SupabaseClient,
  atorId: string,
  alvoId: string,
  acao: string,
  detalhes: Json,
) {
  const { error } = await admin.from("auditoria").insert({
    usuario_id: atorId,
    atividade_id: null,
    entidade: "USUARIO",
    entidade_id: alvoId,
    acao,
    detalhes,
  });

  if (error) {
    console.error("auditoria usuarios");
    throw new Error("FALHA_AUDITORIA");
  }
}

async function enviarRedefinicao(admin: SupabaseClient, email: string, redirectTo: string) {
  const { error } = await admin.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) {
    throw new Error("NAO_FOI_POSSIVEL_ENVIAR_RECUPERACAO");
  }
}

async function criarUsuario(
  req: Request,
  admin: SupabaseClient,
  atorId: string,
  corpo: Json,
  redirectTo: string,
) {
  const nome = normalizarNome(corpo.nome);
  const email = normalizarEmail(corpo.email);
  const telefone = normalizarTelefone(corpo.telefone);
  const perfil = String(corpo.perfil || "").trim().toUpperCase();
  const status = String(corpo.status || "").trim().toUpperCase();

  if (nome.length < 3 || nome.length > 150) {
    return responder(req, 400, { erro: "Informe um nome completo válido.", codigo: "NOME_INVALIDO" });
  }

  if (!EMAIL_RE.test(email)) {
    return responder(req, 400, { erro: "Informe um e-mail válido.", codigo: "EMAIL_INVALIDO" });
  }

  if (!telefoneValido(telefone)) {
    return responder(req, 400, { erro: "Informe um telefone válido ou deixe o campo vazio.", codigo: "TELEFONE_INVALIDO" });
  }

  if (!PERFIS.has(perfil)) {
    return responder(req, 400, { erro: "Perfil inválido.", codigo: "PERFIL_INVALIDO" });
  }

  if (!STATUS.has(status)) {
    return responder(req, 400, { erro: "Status inválido.", codigo: "STATUS_INVALIDO" });
  }

  let criado: { id: string; email?: string | null } | null = null;

  const convite = await admin.auth.admin.inviteUserByEmail(email, {
    data: { nome },
    redirectTo,
  });

  if (convite.error) {
    const mensagem = String(convite.error.message || "").toLowerCase();
    if (mensagem.includes("already") || mensagem.includes("registered") || mensagem.includes("exists")) {
      return responder(req, 409, {
        erro: "Já existe um usuário cadastrado com este e-mail.",
        codigo: "EMAIL_DUPLICADO",
      });
    }

    const criadoDireto = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { nome },
      password: senhaTemporaria(),
    });

    if (criadoDireto.error) {
      const texto = String(criadoDireto.error.message || "").toLowerCase();
      if (texto.includes("already") || texto.includes("registered") || texto.includes("exists")) {
        return responder(req, 409, {
          erro: "Já existe um usuário cadastrado com este e-mail.",
          codigo: "EMAIL_DUPLICADO",
        });
      }

      console.error("criar usuario auth");
      return responder(req, 500, { erro: "Não foi possível criar o usuário.", codigo: "FALHA_CRIACAO" });
    }

    criado = criadoDireto.data.user;
    await enviarRedefinicao(admin, email, redirectTo);
  } else {
    criado = convite.data.user;
  }

  if (!criado?.id) {
    return responder(req, 500, { erro: "Não foi possível criar o usuário.", codigo: "FALHA_CRIACAO" });
  }

  const { data: existente } = await admin
    .from("profiles")
    .select("id, email, perfil, status")
    .eq("id", criado.id)
    .maybeSingle();

  if (!existente) {
    const { error: erroInsert } = await admin.from("profiles").insert({
      id: criado.id,
      nome,
      email,
      telefone,
      perfil,
      status,
    });

    if (erroInsert) {
      console.error("criar profile");
      return responder(req, 500, {
        erro: "A conta de acesso foi criada, mas o perfil não ficou consistente. Tente editar o usuário ou contate o suporte técnico.",
        codigo: "FALHA_PROFILE",
      });
    }
  } else {
    const { error: erroUpdate } = await admin
      .from("profiles")
      .update({ nome, email, telefone, perfil, status })
      .eq("id", criado.id);

    if (erroUpdate) {
      console.error("atualizar profile recem criado");
      return responder(req, 500, {
        erro: "A conta de acesso foi criada, mas o perfil não ficou consistente. Tente editar o usuário.",
        codigo: "FALHA_PROFILE",
      });
    }
  }

  await auditar(admin, atorId, criado.id, "USUARIO_CRIADO", {
    perfil_inicial: perfil,
    status_inicial: status,
  });

  const mensagem = status === "INATIVO"
    ? "Usuário criado com sucesso. As instruções para definição da senha foram enviadas para o e-mail informado. A conta permanecerá sem acesso até ser ativada."
    : "Usuário criado com sucesso. As instruções para definição da senha foram enviadas para o e-mail informado.";

  return responder(req, 200, {
    ok: true,
    mensagem,
    usuario: { id: criado.id, nome, email, perfil, status },
  });
}

async function alterarEmail(
  req: Request,
  admin: SupabaseClient,
  atorId: string,
  corpo: Json,
) {
  const id = String(corpo.id || "").trim();
  const email = normalizarEmail(corpo.email);

  if (!UUID_RE.test(id)) {
    return responder(req, 400, { erro: "Usuário inválido.", codigo: "UUID_INVALIDO" });
  }

  if (!EMAIL_RE.test(email)) {
    return responder(req, 400, { erro: "Informe um e-mail válido.", codigo: "EMAIL_INVALIDO" });
  }

  const { data: atual, error } = await admin
    .from("profiles")
    .select("id, email, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (error || !atual) {
    return responder(req, 400, { erro: "Usuário não encontrado.", codigo: "NAO_ENCONTRADO" });
  }

  if (corpo.updated_at && String(atual.updated_at) !== String(corpo.updated_at)) {
    return responder(req, 409, {
      erro: "Este usuário foi alterado por outro administrador. Atualize os dados antes de continuar.",
      codigo: "CONCORRENCIA",
    });
  }

  if (normalizarEmail(atual.email) === email) {
    return responder(req, 200, { ok: true, mensagem: "O e-mail informado já está em uso por este usuário." });
  }

  const { data: duplicado } = await admin
    .from("profiles")
    .select("id")
    .neq("id", id)
    .ilike("email", email)
    .maybeSingle();

  if (duplicado) {
    return responder(req, 409, {
      erro: "Já existe um usuário cadastrado com este e-mail.",
      codigo: "EMAIL_DUPLICADO",
    });
  }

  const { error: erroAuth } = await admin.auth.admin.updateUserById(id, {
    email,
    email_confirm: true,
  });

  if (erroAuth) {
    const texto = String(erroAuth.message || "").toLowerCase();
    if (texto.includes("already") || texto.includes("registered") || texto.includes("exists")) {
      return responder(req, 409, {
        erro: "Já existe um usuário cadastrado com este e-mail.",
        codigo: "EMAIL_DUPLICADO",
      });
    }

    console.error("alterar email auth");
    return responder(req, 500, { erro: "Não foi possível alterar o e-mail.", codigo: "FALHA_EMAIL" });
  }

  const { error: erroPerfil } = await admin
    .from("profiles")
    .update({ email })
    .eq("id", id);

  if (erroPerfil) {
    console.error("alterar email profile");
    return responder(req, 500, {
      erro: "O e-mail de acesso foi alterado, mas o perfil precisa ser reconciliado. Tente novamente.",
      codigo: "FALHA_EMAIL_PROFILE",
    });
  }

  await auditar(admin, atorId, id, "EMAIL_ALTERADO", {
    email_alterado: true,
  });

  return responder(req, 200, { ok: true, mensagem: "E-mail atualizado com sucesso." });
}

async function enviarRecuperacao(
  req: Request,
  admin: SupabaseClient,
  atorId: string,
  corpo: Json,
  redirectTo: string,
) {
  const id = String(corpo.id || "").trim();
  if (!UUID_RE.test(id)) {
    return responder(req, 400, { erro: "Usuário inválido.", codigo: "UUID_INVALIDO" });
  }

  const { data: atual, error } = await admin
    .from("profiles")
    .select("id, email")
    .eq("id", id)
    .maybeSingle();

  if (error || !atual?.email) {
    return responder(req, 400, { erro: "Usuário não encontrado.", codigo: "NAO_ENCONTRADO" });
  }

  await enviarRedefinicao(admin, atual.email, redirectTo);
  await auditar(admin, atorId, id, "RECUPERACAO_SENHA_SOLICITADA", {});

  return responder(req, 200, {
    ok: true,
    mensagem: "As instruções para definição da senha foram enviadas para o e-mail informado.",
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cabecalhosCors(req) });
  }

  if (req.method !== "POST") {
    return responder(req, 405, { erro: "Método não permitido.", codigo: "METODO" });
  }

  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  if (!url || !serviceRole) {
    return responder(req, 500, { erro: "Configuração administrativa indisponível.", codigo: "CONFIG" });
  }

  let corpo: Json = {};
  try {
    corpo = await req.json();
  } catch {
    return responder(req, 400, { erro: "Requisição inválida.", codigo: "CORPO" });
  }

  const acao = String(corpo.acao || "").trim().toUpperCase();
  if (!ACOES.has(acao)) {
    return responder(req, 400, { erro: "Ação administrativa inválida.", codigo: "ACAO_INVALIDA" });
  }

  const origem = req.headers.get("Origin") || "";
  const redirectTo = validarRedirect(corpo.redirectTo, origem);
  if ((acao === "CRIAR_USUARIO" || acao === "ENVIAR_RECUPERACAO") && !redirectTo) {
    return responder(req, 400, { erro: "URL de redefinição inválida.", codigo: "REDIRECT" });
  }

  const admin = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const ator = await obterAdminAtivo(req, admin);
  if (ator instanceof Response) {
    return ator;
  }

  try {
    if (acao === "CRIAR_USUARIO") {
      return await criarUsuario(req, admin, ator.id, corpo, redirectTo as string);
    }

    if (acao === "ALTERAR_EMAIL") {
      return await alterarEmail(req, admin, ator.id, corpo);
    }

    return await enviarRecuperacao(req, admin, ator.id, corpo, redirectTo as string);
  } catch (erro) {
    const texto = String((erro as Error)?.message || "");
    if (texto === "NAO_FOI_POSSIVEL_ENVIAR_RECUPERACAO") {
      return responder(req, 500, {
        erro: "Não foi possível enviar as instruções de redefinição de senha.",
        codigo: "FALHA_RECUPERACAO",
      });
    }

    console.error("admin-usuarios");
    return responder(req, 500, { erro: "Não foi possível concluir a operação administrativa.", codigo: "FALHA" });
  }
});
