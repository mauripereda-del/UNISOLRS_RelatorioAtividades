import { STATUS_EXIBIDO, urlNovaAtividade, urlVisualizarAtividade } from "./config.js";
import { obterAtividadesRecentes, obterIndicadoresDashboard, podeEditarAtividade } from "./atividades.js";
import { ehAdministrador, protegerPagina } from "./guards.js";
import {
  atualizarNavegacao,
  configurarMenuMobile,
  configurarModulos,
  configurarSaida,
  preencherIdentidade,
} from "./layout.js";
import {
  aplicarStatusExibido,
  contarPendentes,
  criarBadgeStatusExibido,
  listarReaberturasDoUsuario,
  resumirReaberturasUsuario,
  selecionarAlertasReabertura,
} from "./reabertura.js";
import { definirTexto, formatarDataCivil, formatarDataHora, formatarDataPorExtenso } from "./utils.js";

function formatarRespondidaEm(data) {
  const bruto = formatarDataHora(data).replace(",", "");
  const partes = bruto.split(/\s+/).filter(Boolean);

  if (partes.length < 2) {
    return `Respondida em ${bruto}`;
  }

  return `Respondida em ${partes[0]} às ${partes.slice(1).join(" ")}`;
}

function resumoAtividade(registro) {
  const texto = String(registro?.descricao || registro?.introducao || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!texto) {
    return "Atividade sem descrição";
  }

  return texto.length > 72 ? `${texto.slice(0, 72)}…` : texto;
}

function preencherNotasIndicadores(perfil) {
  const admin = ehAdministrador(perfil);

  definirTexto(
    document.getElementById("nota-mes"),
    admin ? "Cadastradas no sistema neste mês" : "Suas atividades neste mês"
  );
  definirTexto(
    document.getElementById("nota-concluidas"),
    admin ? "Concluídas no mês atual" : "Suas atividades concluídas no mês"
  );
  definirTexto(
    document.getElementById("nota-rascunhos"),
    admin ? "Rascunhos no sistema" : "Seus rascunhos"
  );
  definirTexto(
    document.getElementById("nota-ano"),
    admin ? "Cadastradas no sistema neste ano" : "Suas atividades neste ano"
  );
}

function preencherIndicadores(indicadores) {
  definirTexto(document.getElementById("indicador-mes"), String(indicadores.atividadesMes));
  definirTexto(document.getElementById("indicador-concluidas"), String(indicadores.atividadesConcluidas));
  definirTexto(document.getElementById("indicador-rascunhos"), String(indicadores.rascunhos));
  definirTexto(document.getElementById("indicador-ano"), String(indicadores.atividadesAno));
}

function renderizarAtividadesRecentes(registros, contexto) {
  const vazio = document.getElementById("atividades-vazias");
  const tabela = document.getElementById("tabela-recentes");
  const corpo = document.getElementById("corpo-recentes");

  if (!vazio || !tabela || !corpo) {
    return;
  }

  corpo.replaceChildren();

  if (!registros.length) {
    vazio.hidden = false;
    tabela.hidden = true;
    return;
  }

  vazio.hidden = true;
  tabela.hidden = false;

  registros.forEach((registro) => {
    const linha = document.createElement("tr");

    const data = document.createElement("td");
    data.textContent = formatarDataCivil(registro.data_atividade);

    const atividade = document.createElement("td");
    atividade.textContent = resumoAtividade(registro);

    const situacao = document.createElement("td");
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

    situacao.append(bloco);

    const atualizacao = document.createElement("td");
    atualizacao.textContent = formatarDataHora(registro.updated_at);

    const acoes = document.createElement("td");
    const grupo = document.createElement("div");
    grupo.className = "acoes-tabela";

    const visualizar = document.createElement("a");
    visualizar.className = "botao botao--texto";
    visualizar.href = urlVisualizarAtividade(registro.id);
    visualizar.textContent = "Visualizar";
    grupo.append(visualizar);

    if (podeEditarAtividade(registro, contexto.perfil, contexto.usuario)) {
      const editar = document.createElement("a");
      editar.className = "botao botao--texto";
      editar.href = urlNovaAtividade(registro.id);
      editar.textContent = "Editar";
      grupo.append(editar);
    }

    acoes.append(grupo);
    linha.append(data, atividade, situacao, atualizacao, acoes);
    corpo.append(linha);
  });
}

function renderizarAlertasMobilizador(solicitacoes) {
  const painel = document.getElementById("painel-reaberturas-mobilizador");
  const secao = document.getElementById("atualizacoes-reabertura");
  const lista = document.getElementById("lista-atualizacoes-reabertura");
  const resumo = resumirReaberturasUsuario(solicitacoes);
  const alertas = selecionarAlertasReabertura(solicitacoes);

  if (painel) {
    painel.hidden = false;
    const partes = [`${resumo.pendentes} ${resumo.pendentes === 1 ? "pendente" : "pendentes"}`];
    if (resumo.aprovadas) {
      partes.push(`${resumo.aprovadas} ${resumo.aprovadas === 1 ? "aprovada" : "aprovadas"}`);
    }
    if (resumo.recusadas) {
      partes.push(`${resumo.recusadas} ${resumo.recusadas === 1 ? "recusada" : "recusadas"}`);
    }
    definirTexto(document.getElementById("valor-reaberturas-mobilizador"), String(resumo.pendentes));
    definirTexto(document.getElementById("nota-reaberturas-mobilizador"), partes.join(" · "));
  }

  if (!secao || !lista) {
    return;
  }

  lista.replaceChildren();

  if (!alertas.length) {
    secao.hidden = true;
    return;
  }

  secao.hidden = false;

  alertas.forEach((item) => {
    const artigo = document.createElement("article");
    artigo.className = "alerta-reabertura";
    const dataAtividade = formatarDataCivil(item.atividades?.data_atividade);
    const titulo = document.createElement("strong");
    const texto = document.createElement("p");
    const acao = document.createElement("a");
    acao.className = "botao botao--texto";

    if (item.status === "PENDENTE") {
      titulo.textContent = "Reabertura aguardando análise";
      texto.textContent = `Sua solicitação referente à atividade de ${dataAtividade} está aguardando análise administrativa.`;
      acao.href = urlVisualizarAtividade(item.atividade_id);
      acao.textContent = "Ver Atividade";
    } else if (item.status === "APROVADA") {
      titulo.textContent = "Reabertura aprovada";
      texto.textContent = `Sua solicitação referente à atividade de ${dataAtividade} foi aprovada. Você já pode editar a atividade.`;
      acao.href = urlNovaAtividade(item.atividade_id);
      acao.textContent = "Editar Atividade";
    } else {
      titulo.textContent = "Reabertura recusada";
      texto.textContent = `Sua solicitação referente à atividade de ${dataAtividade} foi recusada.`;
      acao.href = urlVisualizarAtividade(item.atividade_id);
      acao.textContent = "Ver Detalhes";
    }

    artigo.append(titulo, texto);

    if (item.analisado_em && item.status !== "PENDENTE") {
      const quando = document.createElement("p");
      quando.className = "alerta-reabertura__meta";
      quando.textContent = formatarRespondidaEm(item.analisado_em);
      artigo.append(quando);
    }

    artigo.append(acao);
    lista.append(artigo);
  });
}

async function iniciar() {
  const aviso = document.getElementById("aviso-configuracao");

  try {
    const contexto = await protegerPagina();
    if (!contexto) {
      return;
    }

    preencherIdentidade(contexto);
    definirTexto(document.getElementById("data-atual"), formatarDataPorExtenso());
    preencherNotasIndicadores(contexto.perfil);
    atualizarNavegacao(contexto.perfil);
    configurarMenuMobile();
    configurarSaida();
    configurarModulos();

    const admin = ehAdministrador(contexto.perfil);

    const [indicadores, recentes, pendentesAdmin, reaberturasUsuario] = await Promise.all([
      obterIndicadoresDashboard(contexto),
      obterAtividadesRecentes(contexto, 5),
      admin ? contarPendentes().catch(() => 0) : Promise.resolve(null),
      admin ? Promise.resolve([]) : listarReaberturasDoUsuario().catch(() => []),
    ]);

    preencherIndicadores(indicadores);
    renderizarAtividadesRecentes(await aplicarStatusExibido(recentes), contexto);

    const painelAdmin = document.getElementById("painel-reaberturas");
    if (painelAdmin && pendentesAdmin !== null) {
      painelAdmin.hidden = false;
      definirTexto(document.getElementById("indicador-reaberturas"), String(pendentesAdmin));
    }

    if (!admin) {
      renderizarAlertasMobilizador(reaberturasUsuario);
    }
  } catch (erro) {
    if (aviso) {
      aviso.hidden = false;
      aviso.textContent = erro.message;
    }
  }
}

iniciar();
