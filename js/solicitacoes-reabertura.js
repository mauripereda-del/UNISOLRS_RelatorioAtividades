import {
  CLASSE_STATUS_SOLICITACAO,
  REABERTURA,
  ROTULO_STATUS_SOLICITACAO,
  STATUS_SOLICITACAO,
  urlVisualizarAtividade,
} from "./config.js";
import { listarResponsaveisFiltro } from "./atividades.js";
import { protegerPaginaAdmin } from "./guards.js";
import {
  atualizarNavegacao,
  configurarMenuMobile,
  configurarModulos,
  configurarSaida,
  preencherIdentidade,
} from "./layout.js";
import {
  aprovarReabertura,
  listarSolicitacoesAdmin,
  mensagemErroReabertura,
  recusarReabertura,
} from "./reabertura.js";
import {
  exibirMensagem,
  formatarDataCivil,
  formatarDataHora,
  limparMensagem,
  resumirTexto,
} from "./utils.js";

let carregando = false;
let processando = false;
let paginaAtual = 1;
let totalAtual = 0;
let alvoAtual = null;

function filtrosDoFormulario() {
  return {
    status: document.getElementById("filtro-status")?.value || STATUS_SOLICITACAO.PENDENTE,
    mobilizador: document.getElementById("filtro-mobilizador")?.value || "",
    inicio: document.getElementById("filtro-inicio")?.value || "",
    fim: document.getElementById("filtro-fim")?.value || "",
    pagina: paginaAtual,
  };
}

function periodoInvalido(filtros) {
  return Boolean(filtros.inicio && filtros.fim && filtros.inicio > filtros.fim);
}

function definirCarregando(ativo) {
  carregando = ativo;
  const indicador = document.getElementById("carregando-solicitacoes");
  if (indicador) {
    indicador.hidden = !ativo;
  }

  ["botao-filtrar", "botao-limpar", "pagina-anterior", "pagina-proxima"].forEach((id) => {
    const botao = document.getElementById(id);
    if (botao) {
      botao.disabled = ativo;
    }
  });
}

function limparResultados() {
  document.getElementById("corpo-solicitacoes")?.replaceChildren();
  document.getElementById("cards-solicitacoes")?.replaceChildren();
}

function atualizarEstadoVazio(temResultados) {
  const vazio = document.getElementById("lista-vazia");
  const tabela = document.getElementById("tabela-solicitacoes-envoltorio");
  const cards = document.getElementById("cards-solicitacoes");

  if (vazio) {
    vazio.hidden = temResultados;
    vazio.setAttribute("aria-hidden", temResultados ? "true" : "false");
  }

  if (tabela) {
    tabela.hidden = !temResultados;
  }

  if (cards) {
    cards.hidden = !temResultados;
  }
}

function criarBadge(status) {
  const badge = document.createElement("span");
  badge.className = CLASSE_STATUS_SOLICITACAO[status] || "status";
  badge.textContent = ROTULO_STATUS_SOLICITACAO[status] || status;
  return badge;
}

function renderizarLista(registros) {
  const corpo = document.getElementById("corpo-solicitacoes");
  const cards = document.getElementById("cards-solicitacoes");
  corpo.replaceChildren();
  cards.replaceChildren();

  registros.forEach((item) => {
    const atividade = item.atividades || {};
    const resumo = resumirTexto(atividade.descricao || atividade.introducao, 100);

    const linha = document.createElement("tr");
    const celulas = [
      formatarDataHora(item.solicitado_em),
      item.mobilizadorNome,
      formatarDataCivil(atividade.data_atividade),
      resumo,
      item.motivo,
    ];

    celulas.forEach((texto) => {
      const td = document.createElement("td");
      td.textContent = texto || "—";
      linha.append(td);
    });

    const status = document.createElement("td");
    status.append(criarBadge(item.status));
    linha.append(status);

    const acoes = document.createElement("td");
    acoes.append(criarAcoes(item));
    linha.append(acoes);
    corpo.append(linha);

    const cartao = document.createElement("article");
    cartao.className = "cartao-historico";
    const topo = document.createElement("div");
    topo.className = "cartao-historico__topo";
    const data = document.createElement("strong");
    data.textContent = formatarDataHora(item.solicitado_em);
    topo.append(data, criarBadge(item.status));
    const titulo = document.createElement("p");
    titulo.textContent = `${item.mobilizadorNome} · ${resumo}`;
    const motivo = document.createElement("p");
    motivo.className = "cartao-historico__meta";
    motivo.textContent = item.motivo;
    cartao.append(topo, titulo, motivo, criarAcoes(item));
    cards.append(cartao);
  });
}

function criarAcoes(item) {
  const grupo = document.createElement("div");
  grupo.className = "acoes-tabela";

  const visualizar = document.createElement("a");
  visualizar.className = "botao botao--texto";
  visualizar.href = urlVisualizarAtividade(item.atividade_id);
  visualizar.textContent = "Visualizar Atividade";
  grupo.append(visualizar);

  if (item.status === STATUS_SOLICITACAO.PENDENTE) {
    const aprovar = document.createElement("button");
    aprovar.className = "botao botao--texto";
    aprovar.type = "button";
    aprovar.textContent = "Aprovar";
    aprovar.addEventListener("click", () => abrirAprovar(item));

    const recusar = document.createElement("button");
    recusar.className = "botao botao--texto";
    recusar.type = "button";
    recusar.textContent = "Recusar";
    recusar.addEventListener("click", () => abrirRecusar(item));

    grupo.append(aprovar, recusar);
  }

  return grupo;
}

function atualizarPaginacao(total, pagina) {
  const resumo = document.getElementById("resumo-pagina");
  const paginacao = document.getElementById("paginacao");
  const anterior = document.getElementById("pagina-anterior");
  const proxima = document.getElementById("pagina-proxima");
  const inicio = total === 0 ? 0 : (pagina - 1) * REABERTURA.porPagina + 1;
  const fim = Math.min(pagina * REABERTURA.porPagina, total);

  resumo.textContent = total
    ? `Exibindo ${inicio}–${fim} de ${total} solicitações`
    : "Exibindo 0 de 0 solicitações";

  paginacao.hidden = total <= REABERTURA.porPagina;
  anterior.disabled = carregando || pagina <= 1;
  proxima.disabled = carregando || fim >= total;
}

async function carregar() {
  const alerta = document.getElementById("alerta");
  const filtros = filtrosDoFormulario();

  if (periodoInvalido(filtros)) {
    exibirMensagem(alerta, "erro", "A data inicial não pode ser posterior à data final.");
    return;
  }

  definirCarregando(true);
  limparMensagem(alerta);

  try {
    const resultado = await listarSolicitacoesAdmin(filtros);
    paginaAtual = resultado.pagina;
    totalAtual = resultado.total;

    if (!resultado.registros.length) {
      limparResultados();
      atualizarEstadoVazio(false);
    } else {
      atualizarEstadoVazio(true);
      renderizarLista(resultado.registros);
    }

    atualizarPaginacao(resultado.total, resultado.pagina);
  } catch (erro) {
    console.error("Solicitações:", erro);
    exibirMensagem(alerta, "erro", "Não foi possível carregar as solicitações. Tente novamente.");
  } finally {
    definirCarregando(false);
    atualizarPaginacao(totalAtual, paginaAtual);
  }
}

function abrirAprovar(item) {
  alvoAtual = item;
  document.getElementById("aprovar-mobilizador").textContent = item.mobilizadorNome;
  document.getElementById("aprovar-resumo").textContent = resumirTexto(
    item.atividades?.descricao || item.atividades?.introducao,
    140
  );
  document.getElementById("aprovar-motivo").textContent = item.motivo;
  document.getElementById("observacao-aprovar").value = "";
  document.getElementById("dialogo-aprovar").showModal();
}

function abrirRecusar(item) {
  alvoAtual = item;
  document.getElementById("recusar-motivo").value = "";
  document.getElementById("contador-recusa").textContent = `0 / ${REABERTURA.recusaMaxima}`;
  document.getElementById("dialogo-recusar").showModal();
}

function fecharDialogos() {
  document.getElementById("dialogo-aprovar")?.close();
  document.getElementById("dialogo-recusar")?.close();
  alvoAtual = null;
}

async function confirmarAprovacao() {
  const alerta = document.getElementById("alerta");
  if (!alvoAtual || processando) {
    return;
  }

  processando = true;
  const botao = document.getElementById("confirmar-aprovar");
  botao.disabled = true;
  botao.textContent = "Processando...";

  try {
    await aprovarReabertura(alvoAtual.id, document.getElementById("observacao-aprovar").value);
    fecharDialogos();
    exibirMensagem(alerta, "sucesso", "Reabertura aprovada. A atividade retornou para Rascunho.");
    await carregar();
  } catch (erro) {
    console.error("Aprovar:", erro);
    exibirMensagem(alerta, "erro", mensagemErroReabertura(erro));
  } finally {
    processando = false;
    botao.disabled = false;
    botao.textContent = "Confirmar Aprovação";
  }
}

async function confirmarRecusa() {
  const alerta = document.getElementById("alerta");
  const texto = document.getElementById("recusar-motivo").value.trim();

  if (texto.length < REABERTURA.recusaMinima) {
    exibirMensagem(alerta, "erro", "O motivo da recusa deve possuir entre 10 e 1000 caracteres.");
    return;
  }

  if (!alvoAtual || processando) {
    return;
  }

  processando = true;
  const botao = document.getElementById("confirmar-recusar");
  botao.disabled = true;
  botao.textContent = "Processando...";

  try {
    await recusarReabertura(alvoAtual.id, texto);
    fecharDialogos();
    exibirMensagem(alerta, "sucesso", "Solicitação de reabertura recusada.");
    await carregar();
  } catch (erro) {
    console.error("Recusar:", erro);
    exibirMensagem(alerta, "erro", mensagemErroReabertura(erro));
  } finally {
    processando = false;
    botao.disabled = false;
    botao.textContent = "Confirmar Recusa";
  }
}

async function preencherMobilizadores() {
  const seletor = document.getElementById("filtro-mobilizador");
  const responsaveis = await listarResponsaveisFiltro();
  const nomes = responsaveis.map((item) => item.nome);
  const repetidos = new Set(nomes.filter((nome, indice) => nomes.indexOf(nome) !== indice));

  responsaveis.forEach((item) => {
    const opcao = document.createElement("option");
    opcao.value = item.id;
    opcao.textContent = repetidos.has(item.nome) && item.email ? `${item.nome} — ${item.email}` : item.nome;
    seletor.append(opcao);
  });
}

async function iniciar() {
  const aviso = document.getElementById("aviso-configuracao");

  try {
    const contexto = await protegerPaginaAdmin();
    if (!contexto) {
      return;
    }

    preencherIdentidade(contexto);
    atualizarNavegacao(contexto.perfil);
    configurarMenuMobile();
    configurarSaida();
    configurarModulos();

    await preencherMobilizadores();

    const statusInicial = new URLSearchParams(window.location.search).get("status");
    if (["PENDENTE", "APROVADA", "RECUSADA"].includes(statusInicial)) {
      document.getElementById("filtro-status").value = statusInicial;
    }

    await carregar();

    document.getElementById("form-filtros").addEventListener("submit", (evento) => {
      evento.preventDefault();
      if (carregando || processando) {
        return;
      }

      paginaAtual = 1;
      carregar();
    });

    document.getElementById("botao-limpar").addEventListener("click", () => {
      if (carregando || processando) {
        return;
      }

      document.getElementById("filtro-status").value = STATUS_SOLICITACAO.PENDENTE;
      document.getElementById("filtro-mobilizador").value = "";
      document.getElementById("filtro-inicio").value = "";
      document.getElementById("filtro-fim").value = "";
      paginaAtual = 1;
      carregar();
    });

    document.getElementById("pagina-anterior").addEventListener("click", () => {
      if (paginaAtual > 1) {
        paginaAtual -= 1;
        carregar();
      }
    });

    document.getElementById("pagina-proxima").addEventListener("click", () => {
      if (paginaAtual * REABERTURA.porPagina < totalAtual) {
        paginaAtual += 1;
        carregar();
      }
    });

    document.getElementById("confirmar-aprovar").addEventListener("click", confirmarAprovacao);
    document.getElementById("cancelar-aprovar").addEventListener("click", fecharDialogos);
    document.getElementById("confirmar-recusar").addEventListener("click", confirmarRecusa);
    document.getElementById("cancelar-recusar").addEventListener("click", fecharDialogos);
    document.getElementById("recusar-motivo").addEventListener("input", (evento) => {
      document.getElementById("contador-recusa").textContent =
        `${evento.target.value.length} / ${REABERTURA.recusaMaxima}`;
    });
  } catch (erro) {
    if (aviso) {
      aviso.hidden = false;
      aviso.textContent = erro.message;
    }
  }
}

iniciar();
