import { obterUrlRedefinicaoSenha, PERFIS, STATUS_USUARIO } from "./config.js";
import { obterClienteSupabase } from "./supabase.js";
import { validarEmail } from "./utils.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizarEmailAdmin(email) {
  return String(email || "").trim().toLowerCase();
}

export function normalizarNomeAdmin(nome) {
  return String(nome || "").replace(/\s+/g, " ").trim();
}

export function normalizarTelefoneAdmin(telefone) {
  return String(telefone || "").trim();
}

export function validarNomeAdmin(nome) {
  const valor = normalizarNomeAdmin(nome);
  return valor.length >= 3 && valor.length <= 150;
}

export function validarTelefoneAdmin(telefone) {
  const valor = normalizarTelefoneAdmin(telefone);
  if (!valor) {
    return true;
  }

  if (!/^[0-9+()\s-]{8,20}$/.test(valor)) {
    return false;
  }

  const digitos = valor.replace(/\D/g, "");
  return digitos.length >= 10 && digitos.length <= 13;
}

export function validarPerfilAdmin(perfil) {
  return Object.values(PERFIS).includes(perfil);
}

export function validarStatusAdmin(status) {
  return Object.values(STATUS_USUARIO).includes(status);
}

export async function chamarAdminUsuarios(acao, payload = {}) {
  const supabase = obterClienteSupabase();
  const { data: sessao, error: erroSessao } = await supabase.auth.getSession();

  if (erroSessao || !sessao.session?.access_token) {
    const erro = new Error("Sessão inválida ou expirada.");
    erro.codigo = "NAO_AUTENTICADO";
    erro.status = 401;
    throw erro;
  }

  const { data, error } = await supabase.functions.invoke("admin-usuarios", {
    body: {
      acao,
      redirectTo: obterUrlRedefinicaoSenha(),
      ...payload,
    },
  });

  if (error) {
    let detalhe = {};
    try {
      detalhe = await error.context.json();
    } catch (_erro) {
      detalhe = {};
    }

    const falha = new Error(detalhe.erro || "Não foi possível concluir a operação administrativa.");
    falha.codigo = detalhe.codigo || error.context?.status || "FALHA";
    falha.status = error.context?.status || 500;
    throw falha;
  }

  if (data?.erro) {
    const falha = new Error(data.erro);
    falha.codigo = data.codigo || "FALHA";
    throw falha;
  }

  return data;
}

export function mensagemErroAdminUsuarios(erro) {
  const texto = String(erro?.message || "");
  const codigo = String(erro?.codigo || erro?.status || "");

  if (codigo === 401 || codigo === "NAO_AUTENTICADO") {
    return "Sessão inválida ou expirada. Entre novamente.";
  }

  if (codigo === 403 || codigo === "PROIBIDO") {
    return "Acesso não autorizado.";
  }

  if (
    texto.includes("último administrador") ||
    texto.includes("própria conta") ||
    texto.includes("próprio perfil") ||
    texto.includes("atualize os dados") ||
    texto.includes("Já existe um usuário") ||
    texto.includes("e-mail") ||
    texto.includes("nome") ||
    texto.includes("Perfil") ||
    texto.includes("Status")
  ) {
    return texto;
  }

  if (codigo === "EMAIL_DUPLICADO") {
    return "Já existe um usuário cadastrado com este e-mail.";
  }

  if (codigo === "CONCORRENCIA") {
    return "Este usuário foi alterado por outro administrador. Atualize os dados antes de continuar.";
  }

  return texto || "Não foi possível concluir a operação administrativa.";
}

export async function atualizarUsuarioAdmin(dados) {
  const supabase = obterClienteSupabase();
  const { data, error } = await supabase.rpc("atualizar_usuario_admin", {
    p_id: dados.id,
    p_nome: normalizarNomeAdmin(dados.nome),
    p_telefone: normalizarTelefoneAdmin(dados.telefone) || null,
    p_perfil: dados.perfil,
    p_status: dados.status,
    p_updated_at: dados.updated_at,
  });

  if (error) {
    throw new Error(error.message || "Não foi possível salvar as alterações.");
  }

  return data;
}

export async function obterContagensUsuarios(ids) {
  const validos = (ids || []).filter((id) => UUID_RE.test(id));
  if (!validos.length) {
    return {};
  }

  const supabase = obterClienteSupabase();
  const { data, error } = await supabase.rpc("contagens_atividades_usuarios", {
    p_ids: validos,
  });

  if (error) {
    throw error;
  }

  return Object.fromEntries(
    (data || []).map((item) => [
      item.usuario_id,
      {
        total: Number(item.total) || 0,
        rascunhos: Number(item.rascunhos) || 0,
        concluidas: Number(item.concluidas) || 0,
        canceladas: Number(item.canceladas) || 0,
      },
    ])
  );
}

export async function obterUsuarioAdmin(id) {
  if (!UUID_RE.test(id)) {
    return null;
  }

  const supabase = obterClienteSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, nome, email, telefone, perfil, status, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export async function atualizarMeuPerfil({ id, nome, telefone }) {
  const supabase = obterClienteSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .update({
      nome: normalizarNomeAdmin(nome),
      telefone: normalizarTelefoneAdmin(telefone) || null,
    })
    .eq("id", id)
    .select("id, nome, email, telefone, perfil, status, created_at, updated_at")
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Não foi possível salvar o perfil.");
  }

  return data;
}

export function ehUuidUsuario(valor) {
  return UUID_RE.test(String(valor || ""));
}
