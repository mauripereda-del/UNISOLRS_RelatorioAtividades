import { CANCELAMENTO, ROTULO_STATUS_EXIBIDO, STATUS_ATIVIDADE } from "./config.js";
import { obterClienteSupabase } from "./supabase.js";
import { formatarDataCivil, formatarDataHora } from "./utils.js";

export function podeCancelarAtividade(atividade, perfil) {
  if (!atividade || perfil?.perfil !== "ADMIN" || perfil?.status !== "ATIVO") {
    return false;
  }

  return (
    atividade.status === STATUS_ATIVIDADE.RASCUNHO || atividade.status === STATUS_ATIVIDADE.CONCLUIDA
  );
}

export function mensagemErroCancelamento(erro) {
  const mensagem = String(erro?.message || "");

  if (mensagem.includes("reabertura pendente")) {
    return "Esta atividade possui uma solicitação de reabertura pendente. Analise a solicitação antes de cancelar a atividade.";
  }

  if (mensagem.includes("já está cancelada")) {
    return "Esta atividade já está cancelada.";
  }

  if (mensagem.includes("pelo menos 50") || mensagem.includes("motivo do cancelamento")) {
    return "Informe detalhadamente o motivo do cancelamento. O texto deve possuir pelo menos 50 caracteres.";
  }

  if (mensagem.includes("Somente administrador") || mensagem.includes("não possui permissão para cancelar")) {
    return "Somente administrador ativo pode cancelar atividades.";
  }

  if (mensagem.includes("não pode ser alterada") || mensagem.includes("operação administrativa")) {
    return mensagem;
  }

  if (mensagem && !String(erro?.code || "") && !mensagem.includes("violates")) {
    return mensagem;
  }

  return "Não foi possível cancelar a atividade. Tente novamente.";
}

export function formatarDataCancelamento(data) {
  const bruto = formatarDataHora(data).replace(",", "");
  const partes = bruto.split(/\s+/).filter(Boolean);

  if (partes.length < 2) {
    return bruto;
  }

  return `${partes[0]} às ${partes.slice(1).join(" ")}`;
}

export function resumoAtividadeCancelamento(atividade) {
  const texto = String(atividade?.descricao || atividade?.introducao || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!texto) {
    return "Atividade sem descrição";
  }

  return texto.length > 160 ? `${texto.slice(0, 160)}…` : texto;
}

export function rotuloStatusAtual(atividade, statusExibido) {
  return (
    ROTULO_STATUS_EXIBIDO[statusExibido] ||
    ROTULO_STATUS_EXIBIDO[atividade?.status] ||
    atividade?.status ||
    "—"
  );
}

export function atualizarContadorCancelamento(campo, contador) {
  const atual = String(campo?.value || "").trim().length;
  const faltam = Math.max(0, CANCELAMENTO.motivoMinimo - atual);

  if (!contador) {
    return faltam === 0;
  }

  contador.textContent =
    faltam > 0
      ? `${atual} / ${CANCELAMENTO.motivoMinimo} caracteres mínimos. Faltam ${faltam} caracteres.`
      : `${atual} / ${CANCELAMENTO.motivoMinimo} caracteres mínimos. Mínimo atingido.`;
  contador.classList.toggle("contador--ok", faltam === 0);
  contador.classList.toggle("contador--falta", faltam > 0);

  return faltam === 0 && atual <= CANCELAMENTO.motivoMaximo;
}

export async function cancelarAtividade(atividadeId, motivo) {
  const texto = String(motivo || "").trim();

  if (texto.length < CANCELAMENTO.motivoMinimo || texto.length > CANCELAMENTO.motivoMaximo) {
    throw new Error(
      "Informe detalhadamente o motivo do cancelamento. O texto deve possuir pelo menos 50 caracteres."
    );
  }

  const supabase = obterClienteSupabase();
  const { error } = await supabase.rpc("cancelar_atividade", {
    p_atividade_id: atividadeId,
    p_motivo: texto,
  });

  if (error) {
    throw error;
  }
}

export async function obterInformacoesCancelamento(atividadeId) {
  const supabase = obterClienteSupabase();
  const { data, error } = await supabase.rpc("informacoes_cancelamento", {
    p_atividade_id: atividadeId,
  });

  if (error) {
    throw error;
  }

  const registro = Array.isArray(data) ? data[0] : data;
  if (!registro || !registro.cancelada_em) {
    return null;
  }

  return {
    canceladaPor: registro.cancelada_por,
    canceladaPorNome: registro.cancelada_por_nome || "Administrador",
    canceladaEm: registro.cancelada_em,
    motivo: registro.motivo_cancelamento || "",
    dataCivil: formatarDataCivil(registro.cancelada_em),
    dataHora: formatarDataCancelamento(registro.cancelada_em),
  };
}
