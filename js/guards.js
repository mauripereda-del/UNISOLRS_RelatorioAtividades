import { PERFIS, ROTAS, STATUS_USUARIO } from "./config.js";
import { obterSessao, sair } from "./auth.js";
import { obterClienteSupabase } from "./supabase.js";
import { redirecionar } from "./utils.js";

export async function obterUsuarioAutenticado() {
  const sessao = await obterSessao();
  return sessao?.user || null;
}

export async function carregarPerfil(usuarioId) {
  const supabase = obterClienteSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, nome, email, telefone, perfil, status, created_at, updated_at")
    .eq("id", usuarioId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export function usuarioEstaAtivo(perfil) {
  return perfil?.status === STATUS_USUARIO.ATIVO;
}

export function ehAdministrador(perfil) {
  return perfil?.perfil === PERFIS.ADMIN && usuarioEstaAtivo(perfil);
}

export function ehMobilizador(perfil) {
  return perfil?.perfil === PERFIS.MOBILIZADOR;
}

export function redirecionarParaLogin(parametros = {}) {
  const url = new URL(ROTAS.login, window.location.origin);

  Object.entries(parametros).forEach(([chave, valor]) => {
    if (valor) {
      url.searchParams.set(chave, valor);
    }
  });

  redirecionar(url.pathname + url.search);
}

async function encerrarERedirecionar(erro) {
  try {
    await sair();
  } catch (_erroSaida) {
    // Mesmo se o signOut falhar, o acesso à página protegida deve ser recusado.
  }

  redirecionarParaLogin({ erro });
}

export async function protegerPagina() {
  const usuario = await obterUsuarioAutenticado();

  if (!usuario) {
    redirecionarParaLogin();
    return null;
  }

  let perfil;

  try {
    perfil = await carregarPerfil(usuario.id);
  } catch (_erro) {
    await encerrarERedirecionar("perfil");
    return null;
  }

  if (!perfil) {
    await encerrarERedirecionar("perfil");
    return null;
  }

  if (!usuarioEstaAtivo(perfil)) {
    await encerrarERedirecionar("inativo");
    return null;
  }

  document.body.classList.add("app-pronto");
  return { usuario, perfil };
}

export async function protegerPaginaAdmin() {
  const contexto = await protegerPagina();
  if (!contexto) {
    return null;
  }

  if (!ehAdministrador(contexto.perfil)) {
    redirecionar(ROTAS.dashboard);
    return null;
  }

  return contexto;
}

export async function redirecionarSeAutenticado() {
  const usuario = await obterUsuarioAutenticado();

  if (!usuario) {
    return false;
  }

  try {
    const perfil = await carregarPerfil(usuario.id);

    if (!perfil) {
      await encerrarERedirecionar("perfil");
      return true;
    }

    if (!usuarioEstaAtivo(perfil)) {
      await encerrarERedirecionar("inativo");
      return true;
    }

    redirecionar(ROTAS.dashboard);
    return true;
  } catch (_erro) {
    await encerrarERedirecionar("perfil");
    return true;
  }
}
