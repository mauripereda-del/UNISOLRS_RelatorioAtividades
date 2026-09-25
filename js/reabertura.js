import {
  CLASSE_STATUS_EXIBIDO,
  COMPLEMENTO_STATUS_EXIBIDO,
  REABERTURA,
  ROTULO_STATUS_EXIBIDO,
  STATUS_ATIVIDADE,
  STATUS_EXIBIDO,
  STATUS_SOLICITACAO,
} from "./config.js";
import { obterDadosResponsaveis } from "./atividades.js";
import { obterClienteSupabase } from "./supabase.js";

export function mensagemErroReabertura(erro) {
  const mensagem = String(erro?.message || "");

  if (mensagem.includes("Já existe uma solicitação")) {
    return "Já existe uma solicitação de reabertura pendente para esta atividade.";
  }

  if (mensagem.includes("já foi analisada")) {
    return "Esta solicitação já foi analisada por outro administrador.";
  }

  if (
    mensagem.includes("pelo menos 50") ||
    mensagem.includes("entre 20 e 1000") ||
    mensagem.includes("entre 50 e 1000") ||
    mensagem.includes("motivo deve")
  ) {
    return "Informe detalhadamente o motivo da reabertura. O motivo deve possuir pelo menos 50 caracteres.";
  }

  if (mensagem.includes("motivo da recusa")) {
    return "O motivo da recusa deve possuir entre 10 e 1000 caracteres.";
  }

  if (mensagem.includes("não pode solicitar reabertura")) {
    return "Atividade cancelada não pode solicitar reabertura.";
  }

  if (mensagem.includes("está cancelada")) {
    return "A atividade está cancelada e esta solicitação não pode mais ser aprovada.";
  }

  if (mensagem.includes("não está mais concluída")) {
    return "A atividade não está mais concluída e não pode ser reaberta por esta solicitação.";
  }

  if (
    mensagem.includes("Somente mobilizador") ||
    mensagem.includes("Somente administrador") ||
    mensagem.includes("não possui permissão") ||
    mensagem.includes("Somente atividades concluídas")
  ) {
    return mensagem;
  }

  if (mensagem && !String(erro?.code || "") && !mensagem.includes("violates")) {
    return mensagem;
  }

  return "Não foi possível concluir a operação. Tente novamente.";
}

export function obterStatusExibido(atividade, ultimaSolicitacao) {
  const status = atividade?.status;
  const situacao = ultimaSolicitacao?.status;

  if (status === STATUS_ATIVIDADE.CANCELADA) {
    return STATUS_EXIBIDO.CANCELADA;
  }

  if (status === STATUS_ATIVIDADE.RASCUNHO) {
    return situacao === STATUS_SOLICITACAO.APROVADA
      ? STATUS_EXIBIDO.REABERTURA_APROVADA
      : STATUS_EXIBIDO.RASCUNHO;
  }

  if (status === STATUS_ATIVIDADE.CONCLUIDA) {
    if (situacao === STATUS_SOLICITACAO.PENDENTE) {
      return STATUS_EXIBIDO.REABERTURA_SOLICITADA;
    }

    if (situacao === STATUS_SOLICITACAO.RECUSADA) {
      return STATUS_EXIBIDO.REABERTURA_RECUSADA;
    }

    return STATUS_EXIBIDO.CONCLUIDA;
  }

  return status || STATUS_EXIBIDO.RASCUNHO;
}

export function criarBadgeStatusExibido(statusExibido) {
  const badge = document.createElement("span");
  badge.className = CLASSE_STATUS_EXIBIDO[statusExibido] || "status";
  badge.textContent = ROTULO_STATUS_EXIBIDO[statusExibido] || statusExibido || "—";
  return badge;
}

export function complementoStatusExibido(statusExibido) {
  return COMPLEMENTO_STATUS_EXIBIDO[statusExibido] || "";
}

export async function obterUltimasSolicitacoesPorAtividades(ids) {
  const unicos = [...new Set((ids || []).filter(Boolean))];
  const mapa = {};

  if (!unicos.length) {
    return mapa;
  }

  const supabase = obterClienteSupabase();
  const { data, error } = await supabase
    .from("solicitacoes_reabertura")
    .select("id, atividade_id, status, solicitado_em, analisado_em, motivo")
    .in("atividade_id", unicos)
    .order("solicitado_em", { ascending: false });

  if (error) {
    throw error;
  }

  (data || []).forEach((item) => {
    if (!mapa[item.atividade_id]) {
      mapa[item.atividade_id] = item;
    }
  });

  return mapa;
}

export async function aplicarStatusExibido(registros) {
  const lista = registros || [];
  let ultimas = {};

  try {
    ultimas = await obterUltimasSolicitacoesPorAtividades(lista.map((item) => item.id));
  } catch (_erro) {
    ultimas = {};
  }

  return lista.map((item) => {
    const ultima = ultimas[item.id] || null;
    return {
      ...item,
      ultimaSolicitacao: ultima,
      statusExibido: obterStatusExibido(item, ultima),
    };
  });
}

export async function listarReaberturasDoUsuario() {
  const supabase = obterClienteSupabase();
  const { data, error } = await supabase
    .from("solicitacoes_reabertura")
    .select(
      "id, atividade_id, status, solicitado_em, analisado_em, motivo, atividades!inner(id, data_atividade, descricao, introducao, status)"
    )
    .order("solicitado_em", { ascending: false })
    .limit(40);

  if (error) {
    throw error;
  }

  return data || [];
}

export function resumirReaberturasUsuario(solicitacoes) {
  return {
    pendentes: solicitacoes.filter((item) => item.status === STATUS_SOLICITACAO.PENDENTE).length,
    aprovadas: solicitacoes.filter((item) => item.status === STATUS_SOLICITACAO.APROVADA).length,
    recusadas: solicitacoes.filter((item) => item.status === STATUS_SOLICITACAO.RECUSADA).length,
  };
}

export function selecionarAlertasReabertura(solicitacoes) {
  const maisRecentePorAtividade = new Map();

  (solicitacoes || []).forEach((item) => {
    if (!maisRecentePorAtividade.has(item.atividade_id)) {
      maisRecentePorAtividade.set(item.atividade_id, item);
    }
  });

  return [...maisRecentePorAtividade.values()]
    .filter((item) => {
      const statusAtividade = item.atividades?.status;
      if (item.status === STATUS_SOLICITACAO.PENDENTE) {
        return true;
      }
      if (item.status === STATUS_SOLICITACAO.APROVADA && statusAtividade === STATUS_ATIVIDADE.RASCUNHO) {
        return true;
      }
      if (item.status === STATUS_SOLICITACAO.RECUSADA && statusAtividade === STATUS_ATIVIDADE.CONCLUIDA) {
        return true;
      }
      return false;
    })
    .sort((a, b) => String(b.analisado_em || b.solicitado_em).localeCompare(String(a.analisado_em || a.solicitado_em)))
    .slice(0, 5);
}

export async function solicitarReabertura(atividadeId, motivo) {
  const texto = String(motivo || "").trim();

  if (texto.length < REABERTURA.motivoMinimo || texto.length > REABERTURA.motivoMaximo) {
    throw new Error(
      "Informe detalhadamente o motivo da reabertura. O motivo deve possuir pelo menos 50 caracteres."
    );
  }

  const supabase = obterClienteSupabase();
  const { data, error } = await supabase.rpc("solicitar_reabertura", {
    p_atividade_id: atividadeId,
    p_motivo: texto,
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function listarSolicitacoesDaAtividade(atividadeId) {
  const supabase = obterClienteSupabase();
  const { data, error } = await supabase
    .from("solicitacoes_reabertura")
    .select(
      "id, atividade_id, solicitante_id, motivo, status, solicitado_em, analisado_por, analisado_em, observacao_admin"
    )
    .eq("atividade_id", atividadeId)
    .order("solicitado_em", { ascending: true });

  if (error) {
    throw error;
  }

  const registros = data || [];
  const ids = [
    ...registros.map((item) => item.solicitante_id),
    ...registros.map((item) => item.analisado_por),
  ];
  const nomes = await obterDadosResponsaveis(ids);

  return registros.map((item) => ({
    ...item,
    solicitanteNome: nomes[item.solicitante_id]?.nome || "—",
    analistaNome: item.analisado_por ? nomes[item.analisado_por]?.nome || "—" : "",
  }));
}

export async function obterSolicitacaoPendente(atividadeId) {
  const supabase = obterClienteSupabase();
  const { data, error } = await supabase
    .from("solicitacoes_reabertura")
    .select("id, status, motivo, solicitado_em")
    .eq("atividade_id", atividadeId)
    .eq("status", STATUS_SOLICITACAO.PENDENTE)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export async function contarPendentes() {
  const supabase = obterClienteSupabase();
  const { count, error } = await supabase
    .from("solicitacoes_reabertura")
    .select("id", { count: "exact", head: true })
    .eq("status", STATUS_SOLICITACAO.PENDENTE);

  if (error) {
    throw error;
  }

  return count || 0;
}

export async function listarSolicitacoesAdmin(filtros = {}) {
  const pagina = Math.max(1, Number(filtros.pagina) || 1);
  const porPagina = REABERTURA.porPagina;
  const de = (pagina - 1) * porPagina;
  const ate = de + porPagina - 1;
  const supabase = obterClienteSupabase();

  let query = supabase
    .from("solicitacoes_reabertura")
    .select(
      "id, atividade_id, solicitante_id, motivo, status, solicitado_em, analisado_por, analisado_em, observacao_admin, atividades!inner(id, data_atividade, descricao, introducao, usuario_id, status)",
      { count: "exact" }
    );

  if (filtros.status) {
    query = query.eq("status", filtros.status);
  }

  if (filtros.mobilizador) {
    query = query.eq("atividades.usuario_id", filtros.mobilizador);
  }

  if (filtros.inicio) {
    query = query.gte("solicitado_em", `${filtros.inicio}T00:00:00`);
  }

  if (filtros.fim) {
    query = query.lte("solicitado_em", `${filtros.fim}T23:59:59`);
  }

  const { data, error, count } = await query
    .order("fila_analise", { ascending: true })
    .order("solicitado_em", { ascending: true })
    .range(de, ate);

  if (error) {
    throw error;
  }

  const registros = data || [];
  const ids = [
    ...registros.map((item) => item.solicitante_id),
    ...registros.map((item) => item.atividades?.usuario_id),
    ...registros.map((item) => item.analisado_por),
  ];
  const nomes = await obterDadosResponsaveis(ids);

  return {
    registros: registros.map((item) => ({
      ...item,
      solicitanteNome: nomes[item.solicitante_id]?.nome || "—",
      mobilizadorNome: nomes[item.atividades?.usuario_id]?.nome || "—",
      analistaNome: item.analisado_por ? nomes[item.analisado_por]?.nome || "—" : "",
    })),
    total: count || 0,
    pagina,
    porPagina,
  };
}

export async function aprovarReabertura(solicitacaoId, observacao) {
  const supabase = obterClienteSupabase();
  const { error } = await supabase.rpc("aprovar_reabertura", {
    p_solicitacao_id: solicitacaoId,
    p_observacao: observacao || null,
  });

  if (error) {
    throw error;
  }
}

export async function recusarReabertura(solicitacaoId, observacao) {
  const texto = String(observacao || "").trim();

  if (texto.length < REABERTURA.recusaMinima || texto.length > REABERTURA.recusaMaxima) {
    throw new Error("O motivo da recusa deve possuir entre 10 e 1000 caracteres.");
  }

  const supabase = obterClienteSupabase();
  const { error } = await supabase.rpc("recusar_reabertura", {
    p_solicitacao_id: solicitacaoId,
    p_observacao: texto,
  });

  if (error) {
    throw error;
  }
}
