import { ROTULO_ACAO_AUDITORIA, ROTULO_STATUS_ATIVIDADE } from "./config.js";
import { obterDadosResponsaveis } from "./atividades.js";
import { obterClienteSupabase } from "./supabase.js";

const ROTULO_CAMPO = {
  data_atividade: "data da atividade",
  introducao: "introdução",
  descricao: "descrição",
  conclusao: "conclusão",
  status: "status",
  legenda: "legenda",
  nome: "nome",
  telefone: "telefone",
  email: "e-mail",
  perfil: "perfil",
};

export function rotuloAcaoAuditoria(acao) {
  return ROTULO_ACAO_AUDITORIA[acao] || acao || "—";
}

function rotuloStatus(valor) {
  return ROTULO_STATUS_ATIVIDADE[valor] || valor || "—";
}

function rotuloCampo(campo) {
  return ROTULO_CAMPO[campo] || campo;
}

export function resumirDetalhesAuditoria(registro) {
  const detalhes = registro?.detalhes || {};
  const partes = [];

  if (detalhes.status_anterior && detalhes.status_novo) {
    partes.push(`${rotuloStatus(detalhes.status_anterior)} → ${rotuloStatus(detalhes.status_novo)}`);
  }

  if (detalhes.perfil_anterior && detalhes.perfil_novo) {
    partes.push(`${detalhes.perfil_anterior} → ${detalhes.perfil_novo}`);
  }

  if (detalhes.perfil_inicial) {
    partes.push(`Perfil inicial: ${detalhes.perfil_inicial}`);
  }

  if (detalhes.status_inicial) {
    partes.push(`Status inicial: ${detalhes.status_inicial}`);
  }

  if (detalhes.email_alterado) {
    partes.push("E-mail atualizado");
  }

  if (detalhes.motivo) {
    partes.push(`Motivo: ${String(detalhes.motivo)}`);
  }

  if (detalhes.observacao_admin) {
    partes.push(`Observação: ${String(detalhes.observacao_admin)}`);
  }

  if (Array.isArray(detalhes.campos_alterados) && detalhes.campos_alterados.length) {
    partes.push(`Campos alterados: ${detalhes.campos_alterados.map(rotuloCampo).join(", ")}`);
  }

  if (detalhes.nome_arquivo) {
    partes.push(`Arquivo: ${detalhes.nome_arquivo}`);
  }

  return partes.join(" · ") || "—";
}

export async function listarAuditoriaAtividade(atividadeId) {
  const supabase = obterClienteSupabase();
  const { data, error } = await supabase
    .from("auditoria")
    .select("id, usuario_id, atividade_id, entidade, entidade_id, acao, detalhes, created_at")
    .eq("atividade_id", atividadeId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  const registros = data || [];
  const nomes = await obterDadosResponsaveis(registros.map((item) => item.usuario_id));

  return registros.map((item) => ({
    ...item,
    usuarioNome: nomes[item.usuario_id]?.nome || "—",
    acaoRotulo: rotuloAcaoAuditoria(item.acao),
    resumo: resumirDetalhesAuditoria(item),
  }));
}

export async function listarAuditoriaUsuario(usuarioId) {
  const supabase = obterClienteSupabase();
  const { data, error } = await supabase
    .from("auditoria")
    .select("id, usuario_id, atividade_id, entidade, entidade_id, acao, detalhes, created_at")
    .eq("entidade", "USUARIO")
    .eq("entidade_id", usuarioId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  const registros = data || [];
  const nomes = await obterDadosResponsaveis(registros.map((item) => item.usuario_id));

  return registros.map((item) => ({
    ...item,
    usuarioNome: nomes[item.usuario_id]?.nome || "—",
    acaoRotulo: rotuloAcaoAuditoria(item.acao),
    resumo: resumirDetalhesAuditoria(item),
  }));
}
