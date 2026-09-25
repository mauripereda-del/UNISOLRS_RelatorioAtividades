import { HISTORICO, ORDENACAO_HISTORICO, PERFIS, STATUS_ATIVIDADE, STATUS_USUARIO } from "./config.js";
import { obterClienteSupabase } from "./supabase.js";

const INDICADORES_VAZIOS = {
  atividadesMes: 0,
  atividadesConcluidas: 0,
  rascunhos: 0,
  atividadesAno: 0,
};

const CAMPOS_LISTAGEM = "id, usuario_id, data_atividade, introducao, descricao, status, updated_at";
const CAMPOS_HISTORICO =
  "id, usuario_id, data_atividade, introducao, descricao, conclusao, status, created_at, updated_at";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function tabelaAtividadesIndisponivel(erro) {
  const codigo = String(erro?.code || "");
  const mensagem = String(erro?.message || "").toLowerCase();

  return (
    codigo === "42P01" ||
    codigo === "PGRST205" ||
    mensagem.includes("does not exist") ||
    mensagem.includes("schema cache") ||
    mensagem.includes("could not find the table")
  );
}

function aplicarEscopo(query, { usuario, perfil }) {
  if (perfil?.perfil !== PERFIS.ADMIN) {
    return query.eq("usuario_id", usuario.id);
  }

  return query;
}

function inicioIso(ano, mes = 0, dia = 1) {
  const data = new Date(ano, mes, dia);
  const anoTxt = String(data.getFullYear());
  const mesTxt = String(data.getMonth() + 1).padStart(2, "0");
  const diaTxt = String(data.getDate()).padStart(2, "0");
  return `${anoTxt}-${mesTxt}-${diaTxt}`;
}

function camposPersistencia(campos) {
  return {
    data_atividade: campos.data_atividade,
    introducao: campos.introducao ?? "",
    descricao: campos.descricao ?? "",
    conclusao: campos.conclusao ?? "",
  };
}

export function mensagemErroAtividade(erro) {
  const mensagem = String(erro?.message || "");
  const codigo = String(erro?.code || "");

  if (tabelaAtividadesIndisponivel(erro)) {
    const mensagemOriginal = String(erro?.message || "").toLowerCase();
    if (mensagemOriginal.includes("atividade_fotos")) {
      return "O módulo de fotografias ainda não foi instalado no banco. Execute sql/004_atividade_fotos_storage.sql no Supabase.";
    }

    return "O módulo de atividades ainda não foi instalado no banco. Execute sql/003_atividades.sql no Supabase.";
  }

  if (mensagem && !codigo && !mensagem.includes("violates") && !mensagem.includes("relation")) {
    return mensagem;
  }

  if (
    codigo === "42501" ||
    mensagem.includes("permission") ||
    mensagem.includes("row-level security")
  ) {
    return "Você não possui permissão para editar esta atividade.";
  }

  if (mensagem.includes("atividades_concluida_textos_check")) {
    return "Para concluir, a introdução precisa de 300 caracteres e a descrição e a conclusão, de 500 cada.";
  }

  if (mensagem.includes("pelo menos uma fotografia")) {
    return "Adicione pelo menos uma fotografia antes de concluir a atividade.";
  }

  if (mensagem.includes("Não é permitido alterar o responsável") || mensagem.includes("usuario_id")) {
    return "Não é permitido alterar o responsável pela atividade.";
  }

  if (mensagem.includes("Atividade cancelada não pode ser alterada")) {
    return "Atividade cancelada não pode ser alterada.";
  }

  if (mensagem.includes("Fotografias de atividade cancelada")) {
    return "Fotografias de atividade cancelada não podem ser alteradas.";
  }

  if (
    mensagem.includes("não possui permissão") ||
    mensagem.includes("Transição de status") ||
    mensagem.includes("cancelar esta atividade")
  ) {
    return "Você não possui permissão para editar esta atividade.";
  }

  if (codigo === "PGRST116" || mensagem.includes("JSON object requested")) {
    return "Atividade não encontrada ou você não possui acesso a ela.";
  }

  return "Não foi possível concluir a operação. Tente novamente.";
}

export async function obterIndicadoresDashboard(contexto) {
  try {
    const supabase = obterClienteSupabase();
    const agora = new Date();
    const inicioMes = inicioIso(agora.getFullYear(), agora.getMonth(), 1);
    const inicioAno = inicioIso(agora.getFullYear(), 0, 1);
    let tabelaDisponivel = true;

    const contar = async (aplicarFiltro) => {
      if (!tabelaDisponivel) {
        return 0;
      }

      let query = supabase.from("atividades").select("id", { count: "exact", head: true });
      query = aplicarEscopo(query, contexto);

      if (aplicarFiltro) {
        query = aplicarFiltro(query);
      }

      const { count, error } = await query;

      if (error) {
        if (tabelaAtividadesIndisponivel(error)) {
          tabelaDisponivel = false;
        }

        return 0;
      }

      return count || 0;
    };

    const [atividadesMes, atividadesConcluidas, rascunhos, atividadesAno] = await Promise.all([
      contar((query) => query.gte("data_atividade", inicioMes)),
      contar((query) =>
        query.eq("status", STATUS_ATIVIDADE.CONCLUIDA).gte("data_atividade", inicioMes)
      ),
      contar((query) => query.eq("status", STATUS_ATIVIDADE.RASCUNHO)),
      contar((query) => query.gte("data_atividade", inicioAno)),
    ]);

    return {
      atividadesMes,
      atividadesConcluidas,
      rascunhos,
      atividadesAno,
    };
  } catch (_erro) {
    return INDICADORES_VAZIOS;
  }
}

export function ehUuid(valor) {
  return UUID_RE.test(String(valor || ""));
}

export function podeEditarAtividade(atividade, perfil, usuario) {
  if (!atividade || atividade.status === STATUS_ATIVIDADE.CANCELADA) {
    return false;
  }

  if (perfil?.perfil === PERFIS.ADMIN && perfil?.status === STATUS_USUARIO.ATIVO) {
    return true;
  }

  return (
    atividade.status === STATUS_ATIVIDADE.RASCUNHO &&
    (!usuario || atividade.usuario_id === usuario.id)
  );
}

function sanitizarBusca(termo) {
  return String(termo || "")
    .trim()
    .replace(/[%_,.()\\'"]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, HISTORICO.buscaMaxima);
}

function aplicarOrdenacao(query, ordenacao) {
  if (ordenacao === ORDENACAO_HISTORICO.antigas) {
    return query.order("data_atividade", { ascending: true }).order("created_at", { ascending: true });
  }

  if (ordenacao === ORDENACAO_HISTORICO.atualizadas) {
    return query
      .order("updated_at", { ascending: false })
      .order("data_atividade", { ascending: false });
  }

  return query.order("data_atividade", { ascending: false }).order("created_at", { ascending: false });
}

function aplicarFiltrosHistorico(query, filtros, { usuario, perfil }) {
  let filtrada = aplicarEscopo(query, { usuario, perfil });

  if (filtros.inicio) {
    filtrada = filtrada.gte("data_atividade", filtros.inicio);
  }

  if (filtros.fim) {
    filtrada = filtrada.lte("data_atividade", filtros.fim);
  }

  if (filtros.status) {
    filtrada = filtrada.eq("status", filtros.status);
  }

  if (perfil?.perfil === PERFIS.ADMIN && filtros.mobilizador) {
    filtrada = filtrada.eq("usuario_id", filtros.mobilizador);
  }

  if (filtros.idsResponsaveis) {
    filtrada = filtrada.in("usuario_id", filtros.idsResponsaveis);
  }

  if (filtros.busca) {
    const termo = sanitizarBusca(filtros.busca);
    if (termo) {
      filtrada = filtrada.or(
        `introducao.ilike.%${termo}%,descricao.ilike.%${termo}%,conclusao.ilike.%${termo}%`
      );
    }
  }

  return filtrada;
}

export async function obterDadosResponsaveis(ids) {
  const unicos = [...new Set((ids || []).filter(Boolean))];

  if (!unicos.length) {
    return {};
  }

  const supabase = obterClienteSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, nome, email, perfil")
    .in("id", unicos);

  if (error || !data) {
    return {};
  }

  return Object.fromEntries(data.map((item) => [item.id, item]));
}

export async function obterNomesResponsaveis(ids) {
  const dados = await obterDadosResponsaveis(ids);
  return Object.fromEntries(Object.entries(dados).map(([id, item]) => [id, item.nome]));
}

export async function listarMobilizadoresRelatorio() {
  const supabase = obterClienteSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, nome, email, perfil, status")
    .eq("perfil", PERFIS.MOBILIZADOR)
    .order("nome", { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}

export async function listarAnosComAtividades({ contexto, usuarioId }) {
  const supabase = obterClienteSupabase();
  const alvo =
    contexto.perfil?.perfil === PERFIS.ADMIN ? usuarioId || null : contexto.usuario.id;

  let query = supabase.from("atividades").select("data_atividade");
  query = aplicarEscopo(query, contexto);

  if (alvo) {
    query = query.eq("usuario_id", alvo);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  const anos = new Set([new Date().getFullYear()]);
  (data || []).forEach((item) => {
    const ano = Number(String(item.data_atividade || "").slice(0, 4));
    if (Number.isInteger(ano) && ano >= 2000 && ano <= 2100) {
      anos.add(ano);
    }
  });

  return [...anos].sort((a, b) => b - a);
}

export async function listarAtividadesDoPeriodo({ contexto, usuarioId, inicio, fimExclusivo }) {
  const supabase = obterClienteSupabase();
  const alvo =
    contexto.perfil?.perfil === PERFIS.ADMIN ? usuarioId : contexto.usuario.id;

  if (!alvo || !inicio || !fimExclusivo) {
    return [];
  }

  if (contexto.perfil?.perfil !== PERFIS.ADMIN && alvo !== contexto.usuario.id) {
    return [];
  }

  const consultar = async (select) => {
    let query = supabase
      .from("atividades")
      .select(select)
      .eq("usuario_id", alvo)
      .gte("data_atividade", inicio)
      .lt("data_atividade", fimExclusivo)
      .order("data_atividade", { ascending: true })
      .order("created_at", { ascending: true });

    return aplicarEscopo(query, contexto);
  };

  let { data, error } = await consultar(`${CAMPOS_HISTORICO}, atividade_fotos(id)`);

  if (error) {
    const mensagem = String(error.message || "").toLowerCase();
    const semRelacionamento =
      mensagem.includes("relationship") ||
      mensagem.includes("could not find") ||
      mensagem.includes("atividade_fotos");

    if (!semRelacionamento) {
      throw error;
    }

    ({ data, error } = await consultar(CAMPOS_HISTORICO));
    if (error) {
      throw error;
    }
  }

  const registros = data || [];
  const [responsaveis, fotos] = await Promise.all([
    obterDadosResponsaveis(registros.map((item) => item.usuario_id)),
    registros.some((item) => !Array.isArray(item.atividade_fotos))
      ? obterQuantidadesFotos(registros.map((item) => item.id))
      : Promise.resolve({}),
  ]);

  return montarRegistrosHistorico(registros, responsaveis, fotos);
}

export async function listarResponsaveisFiltro() {
  const supabase = obterClienteSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, nome, email, perfil")
    .order("nome", { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}

async function obterIdsPorPerfil(perfilResponsavel) {
  const supabase = obterClienteSupabase();
  const { data, error } = await supabase.from("profiles").select("id").eq("perfil", perfilResponsavel);

  if (error) {
    throw error;
  }

  return (data || []).map((item) => item.id);
}

async function obterQuantidadesFotos(ids) {
  const mapa = Object.fromEntries((ids || []).map((id) => [id, 0]));

  if (!ids?.length) {
    return mapa;
  }

  const supabase = obterClienteSupabase();
  const { data, error } = await supabase
    .from("atividade_fotos")
    .select("atividade_id")
    .in("atividade_id", ids);

  if (error || !data) {
    return mapa;
  }

  data.forEach((item) => {
    mapa[item.atividade_id] = (mapa[item.atividade_id] || 0) + 1;
  });

  return mapa;
}

function montarRegistrosHistorico(registros, responsaveis, fotos) {
  return (registros || []).map((item) => {
    const perfil = responsaveis[item.usuario_id] || {};
    const embarcadas = Array.isArray(item.atividade_fotos) ? item.atividade_fotos.length : null;

    return {
      ...item,
      responsavel: perfil.nome || "—",
      responsavelEmail: perfil.email || "",
      perfilResponsavel: perfil.perfil || "",
      quantidadeFotos: embarcadas === null ? fotos[item.id] || 0 : embarcadas,
    };
  });
}

export async function obterAtividadesRecentes(contexto, limite = 5) {
  try {
    const supabase = obterClienteSupabase();
    let query = supabase
      .from("atividades")
      .select(CAMPOS_LISTAGEM)
      .order("updated_at", { ascending: false })
      .limit(limite);

    query = aplicarEscopo(query, contexto);

    const { data, error } = await query;

    if (error) {
      return [];
    }

    const registros = data || [];
    const nomes = await obterNomesResponsaveis(registros.map((item) => item.usuario_id));

    return registros.map((item) => ({
      ...item,
      responsavel: nomes[item.usuario_id] || "—",
    }));
  } catch (_erro) {
    return [];
  }
}

export async function obterAtividade(id) {
  const supabase = obterClienteSupabase();
  const { data, error } = await supabase.from("atividades").select("*").eq("id", id).maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export async function criarAtividade({ usuario, campos }) {
  const supabase = obterClienteSupabase();
  const { data, error } = await supabase
    .from("atividades")
    .insert({
      usuario_id: usuario.id,
      status: STATUS_ATIVIDADE.RASCUNHO,
      ...camposPersistencia(campos),
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function atualizarAtividade(id, campos) {
  const supabase = obterClienteSupabase();
  const { data, error } = await supabase
    .from("atividades")
    .update(camposPersistencia(campos))
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function concluirAtividade(id, campos) {
  const supabase = obterClienteSupabase();
  const { count, error: erroFotos } = await supabase
    .from("atividade_fotos")
    .select("id", { count: "exact", head: true })
    .eq("atividade_id", id);

  if (!erroFotos && (count || 0) < 1) {
    throw new Error("Adicione pelo menos uma fotografia antes de concluir a atividade.");
  }

  const { data, error } = await supabase
    .from("atividades")
    .update({
      ...camposPersistencia(campos),
      status: STATUS_ATIVIDADE.CONCLUIDA,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function listarAtividades({ contexto, filtros = {} }) {
  const pagina = Math.max(1, Number(filtros.pagina) || 1);
  const porPagina = HISTORICO.porPagina;
  const de = (pagina - 1) * porPagina;
  const ate = de + porPagina - 1;
  const supabase = obterClienteSupabase();

  const extras = { ...filtros };

  if (contexto.perfil?.perfil === PERFIS.ADMIN && extras.perfil) {
    const ids = await obterIdsPorPerfil(extras.perfil);
    if (!ids.length) {
      return { registros: [], total: 0, pagina, porPagina };
    }
    extras.idsResponsaveis = ids;
  }

  const consultar = async (select) => {
    let query = supabase.from("atividades").select(select, { count: "exact" });
    query = aplicarFiltrosHistorico(query, extras, contexto);
    query = aplicarOrdenacao(query, extras.ordenacao);
    return query.range(de, ate);
  };

  let { data, error, count } = await consultar(`${CAMPOS_HISTORICO}, atividade_fotos(id)`);

  if (error) {
    const mensagem = String(error.message || "").toLowerCase();
    const semRelacionamento =
      mensagem.includes("relationship") ||
      mensagem.includes("could not find") ||
      mensagem.includes("atividade_fotos");

    if (!semRelacionamento) {
      throw error;
    }

    ({ data, error, count } = await consultar(CAMPOS_HISTORICO));
    if (error) {
      throw error;
    }
  }

  const registros = data || [];
  const total = count || 0;
  const ultimaPagina = Math.max(1, Math.ceil(total / porPagina) || 1);

  if (total > 0 && pagina > ultimaPagina) {
    return listarAtividades({
      contexto,
      filtros: { ...filtros, pagina: ultimaPagina },
    });
  }

  const [responsaveis, fotos] = await Promise.all([
    obterDadosResponsaveis(registros.map((item) => item.usuario_id)),
    registros.some((item) => !Array.isArray(item.atividade_fotos))
      ? obterQuantidadesFotos(registros.map((item) => item.id))
      : Promise.resolve({}),
  ]);

  return {
    registros: montarRegistrosHistorico(registros, responsaveis, fotos),
    total,
    pagina,
    porPagina,
  };
}

export async function obterAtividadeDetalhada(id) {
  const atividade = await obterAtividade(id);

  if (!atividade) {
    return null;
  }

  const responsaveis = await obterDadosResponsaveis([atividade.usuario_id]);
  const perfil = responsaveis[atividade.usuario_id] || {};

  return {
    ...atividade,
    responsavel: perfil.nome || "—",
    responsavelEmail: perfil.email || "",
    perfilResponsavel: perfil.perfil || "",
  };
}

export const obterIndicadores = obterIndicadoresDashboard;
export const listarAtividadesRecentes = obterAtividadesRecentes;
