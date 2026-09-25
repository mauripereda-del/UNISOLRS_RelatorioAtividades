/**
 * Configurações públicas do frontend.
 *
 * Sem bundler, o navegador não lê arquivos .env.
 * Os valores entram em window.__UNISOL_ENV__ via js/env.js
 * (cópia local) ou via scripts/gerar-env.js no build da Vercel.
 */
export const ROTAS = {
  login: "/index.html",
  dashboard: "/pages/dashboard.html",
  recuperarSenha: "/pages/recuperar-senha.html",
  redefinirSenha: "/pages/redefinir-senha.html",
  novaAtividade: "/pages/nova-atividade.html",
  historico: "/pages/historico.html",
  visualizarAtividade: "/pages/visualizar-atividade.html",
  solicitacoesReabertura: "/pages/solicitacoes-reabertura.html",
  relatorioMensal: "/pages/relatorio-mensal.html",
  usuarios: "/pages/usuarios.html",
  visualizarUsuario: "/pages/visualizar-usuario.html",
  meuPerfil: "/pages/meu-perfil.html",
};

export const MODULOS = {
  dashboard: { rota: ROTAS.dashboard, disponivel: true, titulo: "Dashboard" },
  novaAtividade: { rota: ROTAS.novaAtividade, disponivel: true, titulo: "Nova Atividade" },
  historico: { rota: ROTAS.historico, disponivel: true, titulo: "Histórico de Atividades" },
  solicitacoesReabertura: {
    rota: ROTAS.solicitacoesReabertura,
    disponivel: true,
    titulo: "Solicitações de Reabertura",
  },
  relatorioMensal: { rota: ROTAS.relatorioMensal, disponivel: true, titulo: "Relatório Mensal" },
  usuarios: { rota: ROTAS.usuarios, disponivel: true, titulo: "Usuários" },
  meuPerfil: { rota: ROTAS.meuPerfil, disponivel: true, titulo: "Meu Perfil" },
};

export const PERFIS = {
  ADMIN: "ADMIN",
  MOBILIZADOR: "MOBILIZADOR",
};

export const STATUS_USUARIO = {
  ATIVO: "ATIVO",
  INATIVO: "INATIVO",
};

export const STATUS_ATIVIDADE = {
  RASCUNHO: "RASCUNHO",
  CONCLUIDA: "CONCLUIDA",
  CANCELADA: "CANCELADA",
};

export const SENHA_MINIMA = 8;

export const LIMITES_ATIVIDADE = {
  introducao: 300,
  descricao: 500,
  conclusao: 500,
};

export const FOTOS = {
  bucket: "atividade-fotos",
  maxPorAtividade: 3,
  maxBytes: 5 * 1024 * 1024,
  maxLegenda: 200,
  mimesPermitidos: ["image/jpeg", "image/png"],
  extensoesPermitidas: [".jpg", ".jpeg", ".png"],
  urlAssinadaSegundos: 3600,
};

export const ROTULO_STATUS_ATIVIDADE = {
  RASCUNHO: "Rascunho",
  CONCLUIDA: "Concluída",
  CANCELADA: "Cancelada",
};

export const CLASSE_STATUS_ATIVIDADE = {
  RASCUNHO: "status status--rascunho",
  CONCLUIDA: "status status--concluida",
  CANCELADA: "status status--cancelada",
};

export const HISTORICO = {
  porPagina: 10,
  resumo: 120,
  buscaMaxima: 120,
};

export const STATUS_SOLICITACAO = {
  PENDENTE: "PENDENTE",
  APROVADA: "APROVADA",
  RECUSADA: "RECUSADA",
};

export const ROTULO_STATUS_SOLICITACAO = {
  PENDENTE: "Pendente",
  APROVADA: "Aprovada",
  RECUSADA: "Recusada",
};

export const CLASSE_STATUS_SOLICITACAO = {
  PENDENTE: "status status--pendente",
  APROVADA: "status status--concluida",
  RECUSADA: "status status--cancelada",
};

export const STATUS_EXIBIDO = {
  RASCUNHO: "RASCUNHO",
  CONCLUIDA: "CONCLUIDA",
  CANCELADA: "CANCELADA",
  REABERTURA_SOLICITADA: "REABERTURA_SOLICITADA",
  REABERTURA_APROVADA: "REABERTURA_APROVADA",
  REABERTURA_RECUSADA: "REABERTURA_RECUSADA",
};

export const ROTULO_STATUS_EXIBIDO = {
  RASCUNHO: "Rascunho",
  CONCLUIDA: "Concluída",
  CANCELADA: "Cancelada",
  REABERTURA_SOLICITADA: "Reabertura Solicitada",
  REABERTURA_APROVADA: "Reabertura Aprovada",
  REABERTURA_RECUSADA: "Reabertura Recusada",
};

export const CLASSE_STATUS_EXIBIDO = {
  RASCUNHO: "status status--rascunho",
  CONCLUIDA: "status status--concluida",
  CANCELADA: "status status--cancelada",
  REABERTURA_SOLICITADA: "status status--reabertura-solicitada",
  REABERTURA_APROVADA: "status status--reabertura-aprovada",
  REABERTURA_RECUSADA: "status status--reabertura-recusada",
};

export const COMPLEMENTO_STATUS_EXIBIDO = {
  CANCELADA: "Esta atividade foi cancelada administrativamente e está disponível somente para consulta.",
  REABERTURA_SOLICITADA: "Aguardando análise do administrador.",
  REABERTURA_APROVADA: "A atividade está disponível para correção.",
  REABERTURA_RECUSADA: "A atividade permanece concluída.",
};

export const REABERTURA = {
  motivoMinimo: 50,
  motivoMaximo: 1000,
  recusaMinima: 10,
  recusaMaxima: 1000,
  porPagina: 20,
};

export const CANCELAMENTO = {
  motivoMinimo: 50,
  motivoMaximo: 1000,
};

export const RELATORIO_WORD = {
  fonte: "Arial",
  tamanhoCorpo: 22,
  maxLarguraFoto: 600,
  maxAlturaFoto: 680,
  logo: new URL("../assets/images/logounisol.png", import.meta.url).href,
};

export const ROTULO_ACAO_AUDITORIA = {
  SOLICITOU_REABERTURA: "Solicitação de reabertura",
  APROVOU_REABERTURA: "Reabertura aprovada",
  RECUSOU_REABERTURA: "Reabertura recusada",
  EDICAO_ADMINISTRATIVA: "Edição administrativa",
  FOTO_ADICIONADA_ADMIN: "Fotografia adicionada",
  FOTO_REMOVIDA_ADMIN: "Fotografia removida",
  FOTO_LEGENDA_ALTERADA_ADMIN: "Legenda da fotografia alterada",
  FOTO_REORDENADA_ADMIN: "Fotografias reordenadas",
  CANCELOU_ATIVIDADE: "Atividade cancelada",
  USUARIO_CRIADO: "Usuário criado",
  USUARIO_EDITADO: "Dados cadastrais alterados",
  USUARIO_ATIVADO: "Usuário ativado",
  USUARIO_INATIVADO: "Usuário inativado",
  PERFIL_ALTERADO: "Perfil alterado",
  EMAIL_ALTERADO: "E-mail alterado",
  RECUPERACAO_SENHA_SOLICITADA: "Redefinição de senha solicitada",
};

export const USUARIOS = {
  porPagina: 10,
  buscaMaxima: 80,
};

export const ORDENACAO_USUARIOS = {
  nome: "nome",
  nomeDesc: "nome_desc",
  recentes: "recentes",
  atualizados: "atualizados",
};

export const ORDENACAO_HISTORICO = {
  recentes: "recentes",
  antigas: "antigas",
  atualizadas: "atualizadas",
};

export function urlNovaAtividade(id) {
  if (!id) {
    return ROTAS.novaAtividade;
  }

  return `${ROTAS.novaAtividade}?id=${encodeURIComponent(id)}`;
}

export function urlVisualizarAtividade(id, retorno = "") {
  if (!id) {
    return ROTAS.visualizarAtividade;
  }

  const url = `${ROTAS.visualizarAtividade}?id=${encodeURIComponent(id)}`;
  return retorno ? `${url}&retorno=${encodeURIComponent(retorno)}` : url;
}

export function urlVisualizarUsuario(id, retorno = "") {
  if (!id) {
    return ROTAS.visualizarUsuario;
  }

  const url = `${ROTAS.visualizarUsuario}?id=${encodeURIComponent(id)}`;
  return retorno ? `${url}&retorno=${encodeURIComponent(retorno)}` : url;
}

export function urlHistoricoUsuario(usuarioId) {
  if (!usuarioId) {
    return ROTAS.historico;
  }

  return `${ROTAS.historico}?mobilizador=${encodeURIComponent(usuarioId)}`;
}

export function serializarRetornoRelatorioMensal({ mes, ano, mobilizador } = {}) {
  const params = new URLSearchParams();
  params.set("origem", "relatorio-mensal");

  if (mes) {
    params.set("mes", String(mes));
  }

  if (ano) {
    params.set("ano", String(ano));
  }

  if (mobilizador) {
    params.set("mobilizador", mobilizador);
  }

  return params.toString();
}

export function obterConfiguracao() {
  const env = window.__UNISOL_ENV__ || {};
  const supabaseUrl = String(env.SUPABASE_URL || "").trim();
  const supabaseAnonKey = String(env.SUPABASE_ANON_KEY || "").trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Configuração do Supabase ausente. Copie js/env.example.js para js/env.js e preencha SUPABASE_URL e SUPABASE_ANON_KEY."
    );
  }

  if (supabaseUrl.includes("SEU_PROJETO") || supabaseAnonKey.includes("sua-chave-anon")) {
    throw new Error(
      "As credenciais do Supabase ainda estão com valores de exemplo. Atualize js/env.js."
    );
  }

  return { supabaseUrl, supabaseAnonKey };
}

export function obterUrlRedefinicaoSenha() {
  return `${window.location.origin}${ROTAS.redefinirSenha}`;
}
