import {
  HISTORICO,
  ORDENACAO_HISTORICO,
  ROTAS,
  STATUS_ATIVIDADE,
  STATUS_EXIBIDO,
  urlNovaAtividade,
  urlVisualizarAtividade,
} from "./config.js";
import {
  ehUuid,
  listarAtividades,
  listarResponsaveisFiltro,
  podeEditarAtividade,
} from "./atividades.js";
import { aplicarStatusExibido, criarBadgeStatusExibido } from "./reabertura.js";
import { ehAdministrador, protegerPagina } from "./guards.js";
import {
  atualizarNavegacao,
  configurarMenuMobile,
  configurarModulos,
  configurarSaida,
  preencherIdentidade,
} from "./layout.js";
import {
  exibirMensagem,
  formatarDataCivil,
  formatarDataHora,
  formatarQuantidadeFotos,
  limparMensagem,
  obterParametrosConsulta,
  resumirTexto,
} from "./utils.js";

const STATUS_VALIDOS = new Set(Object.values(STATUS_ATIVIDADE));
const ORDENACOES_VALIDAS = new Set(Object.values(ORDENACAO_HISTORICO));
const PERFIS_VALIDOS = new Set(["ADMIN", "MOBILIZADOR"]);
const DATA_CIVIL = /^\d{4}-\d{2}-\d{2}$/;

let contextoAtual = null;
let consultaAtual = 0;
let paginaAtual = 1;
let totalAtual = 0;
let carregando = false;

function filtrosPadrao() {
  return {
    inicio: "",
    fim: "",
    status: "",
    mobilizador: "",
    perfil: "",
    busca: "",
    ordenacao: ORDENACAO_HISTORICO.recentes,
    pagina: 1,
  };
}

function sanitizarFiltros(origem, { admin } = {}) {
  const filtros = filtrosPadrao();
  const params = origem instanceof URLSearchParams ? origem : new URLSearchParams(origem || "");

  const inicio = String(params.get("inicio") || "").trim();
  const fim = String(params.get("fim") || "").trim();
  const status = String(params.get("status") || "").trim().toUpperCase();
  const mobilizador = String(params.get("mobilizador") || "").trim();
  const perfil = String(params.get("perfil") || "").trim().toUpperCase();
  const busca = String(params.get("busca") || "").trim().slice(0, HISTORICO.buscaMaxima);
  const ordenacao = String(params.get("ordenacao") || "").trim();
  const pagina = Number(params.get("pagina") || 1);

  if (DATA_CIVIL.test(inicio)) {
    filtros.inicio = inicio;
  }

  if (DATA_CIVIL.test(fim)) {
    filtros.fim = fim;
  }

  if (STATUS_VALIDOS.has(status)) {
    filtros.status = status;
  }

  if (admin && ehUuid(mobilizador)) {
    filtros.mobilizador = mobilizador;
  }

  if (admin && PERFIS_VALIDOS.has(perfil)) {
    filtros.perfil = perfil;
  }

  filtros.busca = busca;
  filtros.ordenacao = ORDENACOES_VALIDAS.has(ordenacao) ? ordenacao : ORDENACAO_HISTORICO.recentes;
  filtros.pagina = Number.isInteger(pagina) && pagina > 0 ? pagina : 1;

  return filtros;
}

function lerFiltrosDoFormulario(admin) {
  const params = new URLSearchParams();
  params.set("inicio", document.getElementById("filtro-inicio")?.value || "");
  params.set("fim", document.getElementById("filtro-fim")?.value || "");
  params.set("status", document.getElementById("filtro-status")?.value || "");
  params.set("busca", document.getElementById("filtro-busca")?.value || "");
  params.set("ordenacao", document.getElementById("filtro-ordenacao")?.value || "");

  if (admin) {
    params.set("mobilizador", document.getElementById("filtro-mobilizador")?.value || "");
    params.set("perfil", document.getElementById("filtro-perfil")?.value || "");
  }

  return sanitizarFiltros(params, { admin });
}

function preencherFormulario(filtros, admin) {
  document.getElementById("filtro-inicio").value = filtros.inicio;
  document.getElementById("filtro-fim").value = filtros.fim;
  document.getElementById("filtro-status").value = filtros.status;
  document.getElementById("filtro-busca").value = filtros.busca;
  document.getElementById("filtro-ordenacao").value = filtros.ordenacao;

  if (admin) {
    document.getElementById("filtro-mobilizador").value = filtros.mobilizador;
    document.getElementById("filtro-perfil").value = filtros.perfil;
  }
}

function serializarFiltros(filtros) {
  const params = new URLSearchParams();

  Object.entries(filtros).forEach(([chave, valor]) => {
    if (!valor || (chave === "ordenacao" && valor === ORDENACAO_HISTORICO.recentes) || (chave === "pagina" && valor === 1)) {
      return;
    }

    params.set(chave, String(valor));
  });

  return params.toString();
}

function sincronizarUrl(filtros) {
  const consulta = serializarFiltros(filtros);
  const destino = consulta ? `${ROTAS.historico}?${consulta}` : ROTAS.historico;
  window.history.replaceState({}, "", destino);
}

function periodoInvalido(filtros) {
  return Boolean(filtros.inicio && filtros.fim && filtros.inicio > filtros.fim);
}

function definirCarregando(ativo) {
  carregando = ativo;
  const indicador = document.getElementById("carregando-historico");
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
  document.getElementById("corpo-historico")?.replaceChildren();
  document.getElementById("cards-historico")?.replaceChildren();
}

function atualizarEstadoVazio(temResultados) {
  const vazio = document.getElementById("historico-vazio");
  const tabela = document.getElementById("tabela-historico-envoltorio");
  const cards = document.getElementById("cards-historico");

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

function criarAcoes(registro, { usuario, perfil }, retorno) {
  const grupo = document.createElement("div");
  grupo.className = "acoes-tabela";

  const visualizar = document.createElement("a");
  visualizar.className = "botao botao--texto";
  visualizar.href = urlVisualizarAtividade(registro.id, retorno);
  visualizar.textContent = "Visualizar";
  grupo.append(visualizar);

  if (podeEditarAtividade(registro, perfil, usuario)) {
    const editar = document.createElement("a");
    editar.className = "botao botao--texto";
    editar.href = urlNovaAtividade(registro.id);
    editar.textContent = "Editar";
    grupo.append(editar);
  }

  return grupo;
}

function criarBadgeStatus(registro) {
  const bloco = document.createElement("div");
  bloco.className = "situacao-atividade";
  bloco.append(criarBadgeStatusExibido(registro.statusExibido || registro.status));

  if (registro.statusExibido === STATUS_EXIBIDO.REABERTURA_APROVADA) {
    const extra = document.createElement("small");
    extra.textContent = "Em edição";
    bloco.append(extra);
  } else if (registro.statusExibido === STATUS_EXIBIDO.REABERTURA_RECUSADA) {
    const extra = document.createElement("small");
    extra.textContent = "Atividade permanece concluída";
    bloco.append(extra);
  }

  return bloco;
}

function renderizarTabela(registros, contexto, retorno) {
  const corpo = document.getElementById("corpo-historico");
  corpo.replaceChildren();

  registros.forEach((registro) => {
    const linha = document.createElement("tr");

    const data = document.createElement("td");
    data.textContent = formatarDataCivil(registro.data_atividade);

    const mobilizador = document.createElement("td");
    mobilizador.className = "coluna-mobilizador";
    mobilizador.textContent = registro.responsavel || "—";

    const atividade = document.createElement("td");
    atividade.textContent = resumirTexto(registro.descricao || registro.introducao, HISTORICO.resumo);

    const status = document.createElement("td");
    status.append(criarBadgeStatus(registro));

    const fotos = document.createElement("td");
    fotos.textContent = formatarQuantidadeFotos(registro.quantidadeFotos);

    const atualizacao = document.createElement("td");
    atualizacao.textContent = formatarDataHora(registro.updated_at);

    const acoes = document.createElement("td");
    acoes.append(criarAcoes(registro, contexto, retorno));

    linha.append(data, mobilizador, atividade, status, fotos, atualizacao, acoes);
    corpo.append(linha);
  });
}

function renderizarCards(registros, contexto, retorno, admin) {
  const lista = document.getElementById("cards-historico");
  lista.replaceChildren();

  registros.forEach((registro) => {
    const cartao = document.createElement("article");
    cartao.className = "cartao-historico";

    const topo = document.createElement("div");
    topo.className = "cartao-historico__topo";
    const data = document.createElement("strong");
    data.textContent = formatarDataCivil(registro.data_atividade);
    topo.append(data, criarBadgeStatus(registro));

    const resumo = document.createElement("p");
    resumo.textContent = resumirTexto(registro.descricao || registro.introducao, HISTORICO.resumo);

    cartao.append(topo, resumo);

    if (admin) {
      const responsavel = document.createElement("p");
      responsavel.className = "cartao-historico__meta";
      responsavel.textContent = registro.responsavel || "—";
      cartao.append(responsavel);
    }

    const meta = document.createElement("p");
    meta.className = "cartao-historico__meta";
    meta.textContent = `${formatarQuantidadeFotos(registro.quantidadeFotos)} · ${formatarDataHora(registro.updated_at)}`;

    cartao.append(meta, criarAcoes(registro, contexto, retorno));
    lista.append(cartao);
  });
}

function atualizarPaginacao(total, pagina) {
  const resumo = document.getElementById("resumo-pagina");
  const paginacao = document.getElementById("paginacao");
  const anterior = document.getElementById("pagina-anterior");
  const proxima = document.getElementById("pagina-proxima");
  const porPagina = HISTORICO.porPagina;
  const inicio = total === 0 ? 0 : (pagina - 1) * porPagina + 1;
  const fim = Math.min(pagina * porPagina, total);

  resumo.textContent = total
    ? `Exibindo ${inicio}–${fim} de ${total} atividades`
    : "Exibindo 0 de 0 atividades";

  paginacao.hidden = total <= porPagina;
  anterior.disabled = carregando || pagina <= 1;
  proxima.disabled = carregando || fim >= total;
}

async function carregarHistorico(filtros) {
  const alerta = document.getElementById("alerta");
  if (periodoInvalido(filtros)) {
    exibirMensagem(alerta, "erro", "A data inicial não pode ser posterior à data final.");
    return;
  }

  const id = ++consultaAtual;
  definirCarregando(true);
  limparMensagem(alerta);

  try {
    const resultado = await listarAtividades({
      contexto: contextoAtual,
      filtros,
    });

    if (id !== consultaAtual) {
      return;
    }

    paginaAtual = resultado.pagina;
    totalAtual = resultado.total;
    filtros.pagina = resultado.pagina;
    sincronizarUrl(filtros);

    const retorno = serializarFiltros(filtros);
    const admin = ehAdministrador(contextoAtual.perfil);

    if (!resultado.registros.length) {
      limparResultados();
      atualizarEstadoVazio(false);
      const textoVazio = document.getElementById("historico-vazio-texto");
      if (textoVazio) {
        textoVazio.textContent = admin
          ? "Nenhuma atividade corresponde aos filtros selecionados."
          : "Altere os filtros ou registre uma nova atividade.";
      }
    } else {
      const registros = await aplicarStatusExibido(resultado.registros);
      if (id !== consultaAtual) {
        return;
      }

      atualizarEstadoVazio(true);
      renderizarTabela(registros, contextoAtual, retorno);
      renderizarCards(registros, contextoAtual, retorno, admin);
    }

    atualizarPaginacao(resultado.total, resultado.pagina);
  } catch (erro) {
    if (id !== consultaAtual) {
      return;
    }

    console.error("Histórico:", erro);
    exibirMensagem(alerta, "erro", "Não foi possível carregar o histórico. Tente novamente.");
  } finally {
    if (id === consultaAtual) {
      definirCarregando(false);
      atualizarPaginacao(totalAtual, paginaAtual);
    }
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
    contextoAtual = await protegerPagina();
    if (!contextoAtual) {
      return;
    }

    preencherIdentidade(contextoAtual);
    atualizarNavegacao(contextoAtual.perfil);
    configurarMenuMobile();
    configurarSaida();
    configurarModulos();

    const admin = ehAdministrador(contextoAtual.perfil);
    document.getElementById("campo-mobilizador").hidden = !admin;
    document.getElementById("campo-perfil").hidden = !admin;
    document.body.classList.toggle("historico--sem-mobilizador", !admin);

    if (admin) {
      await preencherMobilizadores();
    }

    const filtros = sanitizarFiltros(obterParametrosConsulta(), { admin });
    preencherFormulario(filtros, admin);
    await carregarHistorico(filtros);

    document.getElementById("form-filtros").addEventListener("submit", (evento) => {
      evento.preventDefault();
      if (carregando) {
        return;
      }

      const proximos = lerFiltrosDoFormulario(admin);
      proximos.pagina = 1;
      carregarHistorico(proximos);
    });

    document.getElementById("botao-limpar").addEventListener("click", () => {
      if (carregando) {
        return;
      }

      const padrao = filtrosPadrao();
      preencherFormulario(padrao, admin);
      carregarHistorico(padrao);
    });

    document.getElementById("pagina-anterior").addEventListener("click", () => {
      if (carregando || paginaAtual <= 1) {
        return;
      }

      const proximos = lerFiltrosDoFormulario(admin);
      proximos.pagina = paginaAtual - 1;
      carregarHistorico(proximos);
    });

    document.getElementById("pagina-proxima").addEventListener("click", () => {
      if (carregando || paginaAtual * HISTORICO.porPagina >= totalAtual) {
        return;
      }

      const proximos = lerFiltrosDoFormulario(admin);
      proximos.pagina = paginaAtual + 1;
      carregarHistorico(proximos);
    });

    window.addEventListener("popstate", () => {
      const restaurados = sanitizarFiltros(obterParametrosConsulta(), { admin });
      preencherFormulario(restaurados, admin);
      carregarHistorico(restaurados);
    });
  } catch (erro) {
    if (aviso) {
      aviso.hidden = false;
      aviso.textContent = erro.message;
    }
  }
}

iniciar();
