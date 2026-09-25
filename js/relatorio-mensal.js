import {
  ehUuid,
  listarAnosComAtividades,
  listarAtividadesDoPeriodo,
  listarMobilizadoresRelatorio,
} from "./atividades.js";
import {
  STATUS_ATIVIDADE,
  STATUS_USUARIO,
  serializarRetornoRelatorioMensal,
  urlVisualizarAtividade,
} from "./config.js";
import { ehAdministrador, protegerPagina } from "./guards.js";
import {
  atualizarNavegacao,
  configurarMenuMobile,
  configurarModulos,
  configurarSaida,
  preencherIdentidade,
} from "./layout.js";
import { aplicarStatusExibido, criarBadgeStatusExibido } from "./reabertura.js";
import {
  gerarRelatorioMensalWord,
  mensagemErroRelatorioWord,
  resumirTextoRelatorio,
} from "./relatorio-word.js";
import {
  exibirMensagem,
  formatarDataCivil,
  formatarQuantidadeFotos,
  limparMensagem,
  obterParametrosConsulta,
} from "./utils.js";

const MESES = [
  { valor: 1, nome: "Janeiro" },
  { valor: 2, nome: "Fevereiro" },
  { valor: 3, nome: "Março" },
  { valor: 4, nome: "Abril" },
  { valor: 5, nome: "Maio" },
  { valor: 6, nome: "Junho" },
  { valor: 7, nome: "Julho" },
  { valor: 8, nome: "Agosto" },
  { valor: 9, nome: "Setembro" },
  { valor: 10, nome: "Outubro" },
  { valor: 11, nome: "Novembro" },
  { valor: 12, nome: "Dezembro" },
];

let contextoAtual = null;
let gerando = false;
let consultaAtual = null;

function nomeMes(mes) {
  return MESES.find((item) => item.valor === mes)?.nome || "—";
}

export function intervaloMes(ano, mes) {
  const inicio = `${ano}-${String(mes).padStart(2, "0")}-01`;
  const proximoMes = mes === 12 ? 1 : mes + 1;
  const proximoAno = mes === 12 ? ano + 1 : ano;
  return {
    inicio,
    fimExclusivo: `${proximoAno}-${String(proximoMes).padStart(2, "0")}-01`,
  };
}

function sanitizarPeriodo(mesBruto, anoBruto) {
  const mes = Number(mesBruto);
  const ano = Number(anoBruto);

  if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
    return null;
  }

  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) {
    return null;
  }

  return { mes, ano };
}

function periodoExtenso(mes, ano) {
  return `${nomeMes(mes)} de ${ano}`;
}

function usuarioAlvo() {
  if (ehAdministrador(contextoAtual.perfil)) {
    return document.getElementById("filtro-mobilizador")?.value || "";
  }

  return contextoAtual.usuario.id;
}

function nomeMobilizadorSelecionado() {
  if (!ehAdministrador(contextoAtual.perfil)) {
    return contextoAtual.perfil.nome || "—";
  }

  const seletor = document.getElementById("filtro-mobilizador");
  const opcao = seletor?.selectedOptions?.[0];
  return opcao?.dataset.nome || opcao?.textContent?.replace(/ — Inativo$/, "") || "—";
}

function preencherMeses(selecionado) {
  const seletor = document.getElementById("filtro-mes");
  seletor.replaceChildren();

  MESES.forEach((item) => {
    const opcao = document.createElement("option");
    opcao.value = String(item.valor);
    opcao.textContent = item.nome;
    seletor.append(opcao);
  });

  seletor.value = String(selecionado);
}

function preencherAnos(anos, selecionado) {
  const seletor = document.getElementById("filtro-ano");
  seletor.replaceChildren();

  const lista = anos.includes(selecionado) ? anos : [selecionado, ...anos].sort((a, b) => b - a);
  lista.forEach((ano) => {
    const opcao = document.createElement("option");
    opcao.value = String(ano);
    opcao.textContent = String(ano);
    seletor.append(opcao);
  });

  seletor.value = String(selecionado);
}

async function atualizarAnos(usuarioId, preferido) {
  const anos = await listarAnosComAtividades({ contexto: contextoAtual, usuarioId });
  preencherAnos(anos, preferido || new Date().getFullYear());
}

function definirGerando(ativo) {
  gerando = ativo;
  ["filtro-mobilizador", "filtro-mes", "filtro-ano", "botao-consultar", "botao-gerar"].forEach((id) => {
    const elemento = document.getElementById(id);
    if (elemento && id !== "botao-gerar") {
      elemento.disabled = ativo;
    }
  });
}

function atualizarProgresso({ texto, percentual } = {}) {
  const painel = document.getElementById("progresso-relatorio");
  const barra = document.getElementById("progresso-barra");
  const rotulo = document.getElementById("progresso-texto");

  if (!painel) {
    return;
  }

  painel.hidden = !texto && !percentual;
  if (rotulo && texto) {
    rotulo.textContent = texto;
  }
  if (barra && typeof percentual === "number") {
    barra.value = Math.max(0, Math.min(100, percentual));
  }
}

function classificarAtividades(registros) {
  const concluidas = [];
  let rascunhos = 0;
  let canceladas = 0;

  registros.forEach((item) => {
    if (item.status === STATUS_ATIVIDADE.CONCLUIDA) {
      concluidas.push(item);
    } else if (item.status === STATUS_ATIVIDADE.RASCUNHO) {
      rascunhos += 1;
    } else if (item.status === STATUS_ATIVIDADE.CANCELADA) {
      canceladas += 1;
    }
  });

  return { concluidas, rascunhos, canceladas };
}

function sincronizarUrl({ mes, ano, mobilizador }) {
  const params = new URLSearchParams();
  params.set("mes", String(mes));
  params.set("ano", String(ano));

  if (ehAdministrador(contextoAtual.perfil) && mobilizador) {
    params.set("mobilizador", mobilizador);
  }

  window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
}

function renderizarPrevia({ mobilizadorNome, mes, ano, concluidas, rascunhos, canceladas }) {
  const previa = document.getElementById("previa-relatorio");
  const vazio = document.getElementById("relatorio-vazio");
  const gerar = document.getElementById("botao-gerar");
  const corpo = document.getElementById("corpo-previa");
  const cards = document.getElementById("cards-previa");
  const retorno = serializarRetornoRelatorioMensal({
    mes,
    ano,
    mobilizador: ehAdministrador(contextoAtual.perfil) ? usuarioAlvo() : "",
  });

  document.getElementById("previa-mobilizador").textContent = mobilizadorNome;
  document.getElementById("previa-periodo").textContent = periodoExtenso(mes, ano);
  document.getElementById("previa-concluidas").textContent = String(concluidas.length);
  document.getElementById("previa-rascunhos").textContent = String(rascunhos);
  document.getElementById("previa-canceladas").textContent = String(canceladas);

  const notaRascunho = document.getElementById("nota-rascunhos");
  const notaCanceladas = document.getElementById("nota-canceladas");
  notaRascunho.hidden = rascunhos === 0;
  notaRascunho.textContent =
    rascunhos === 1
      ? "Existe 1 atividade em rascunho neste período. Ela não faz parte do relatório mensal."
      : `Existem ${rascunhos} atividades em rascunho neste período. Elas não fazem parte do relatório mensal.`;
  notaCanceladas.hidden = canceladas === 0;
  notaCanceladas.textContent =
    canceladas === 1
      ? "Existe 1 atividade cancelada neste período. Ela não faz parte do relatório mensal."
      : `Existem ${canceladas} atividades canceladas neste período. Elas não fazem parte do relatório mensal.`;

  corpo.replaceChildren();
  cards.replaceChildren();

  const temConcluidas = concluidas.length > 0;
  document.getElementById("tabela-previa-envoltorio").hidden = !temConcluidas;
  cards.hidden = !temConcluidas;
  vazio.hidden = temConcluidas;
  vazio.setAttribute("aria-hidden", temConcluidas ? "true" : "false");
  previa.hidden = false;
  gerar.disabled = !temConcluidas;

  if (!temConcluidas) {
    return;
  }

  concluidas.forEach((registro) => {
    const linha = document.createElement("tr");
    const data = document.createElement("td");
    data.textContent = formatarDataCivil(registro.data_atividade);

    const situacao = document.createElement("td");
    situacao.append(criarBadgeStatusExibido(registro.statusExibido || registro.status));

    const resumo = document.createElement("td");
    resumo.textContent = resumirTextoRelatorio(registro.descricao || registro.introducao, 90);

    const fotos = document.createElement("td");
    fotos.textContent = formatarQuantidadeFotos(registro.quantidadeFotos);

    const acao = document.createElement("td");
    const link = document.createElement("a");
    link.className = "botao botao--texto";
    link.href = urlVisualizarAtividade(registro.id, retorno);
    link.textContent = "Visualizar";
    acao.append(link);

    linha.append(data, situacao, resumo, fotos, acao);
    corpo.append(linha);

    const cartao = document.createElement("article");
    cartao.className = "cartao-historico";
    const topo = document.createElement("div");
    topo.className = "cartao-historico__topo";
    const forte = document.createElement("strong");
    forte.textContent = formatarDataCivil(registro.data_atividade);
    topo.append(forte, criarBadgeStatusExibido(registro.statusExibido || registro.status));
    const texto = document.createElement("p");
    texto.textContent = resumirTextoRelatorio(registro.descricao || registro.introducao, 90);
    const meta = document.createElement("p");
    meta.className = "cartao-historico__meta";
    meta.textContent = formatarQuantidadeFotos(registro.quantidadeFotos);
    cartao.append(topo, texto, meta, link.cloneNode(true));
    cards.append(cartao);
  });
}

async function consultar(evento) {
  evento?.preventDefault();
  if (gerando) {
    return;
  }

  const alerta = document.getElementById("alerta");
  const periodo = sanitizarPeriodo(
    document.getElementById("filtro-mes").value,
    document.getElementById("filtro-ano").value
  );

  if (!periodo) {
    exibirMensagem(alerta, "erro", "Informe um mês e um ano válidos.");
    return;
  }

  const mobilizadorId = usuarioAlvo();
  if (ehAdministrador(contextoAtual.perfil) && !ehUuid(mobilizadorId)) {
    exibirMensagem(alerta, "erro", "Selecione o mobilizador para consultar o período.");
    return;
  }

  limparMensagem(alerta);
  document.getElementById("botao-consultar").disabled = true;

  try {
    const { inicio, fimExclusivo } = intervaloMes(periodo.ano, periodo.mes);
    const registros = await listarAtividadesDoPeriodo({
      contexto: contextoAtual,
      usuarioId: mobilizadorId,
      inicio,
      fimExclusivo,
    });
    const comSituacao = await aplicarStatusExibido(registros);
    const classificados = classificarAtividades(comSituacao);
    const mobilizadorNome = nomeMobilizadorSelecionado();

    consultaAtual = {
      ...periodo,
      ...classificados,
      inicio,
      fimExclusivo,
      usuarioId: mobilizadorId,
      mobilizadorNome,
    };

    sincronizarUrl({ ...periodo, mobilizador: mobilizadorId });
    renderizarPrevia({
      mobilizadorNome,
      ...periodo,
      ...classificados,
    });
  } catch (erro) {
    console.error("Relatório mensal:", erro);
    consultaAtual = null;
    document.getElementById("botao-gerar").disabled = true;
    exibirMensagem(alerta, "erro", "Não foi possível consultar as atividades. Tente novamente.");
  } finally {
    document.getElementById("botao-consultar").disabled = gerando;
  }
}

async function gerar() {
  const alerta = document.getElementById("alerta");
  if (gerando || !consultaAtual?.concluidas?.length) {
    return;
  }

  definirGerando(true);
  const botao = document.getElementById("botao-gerar");
  botao.disabled = true;
  botao.textContent = "Gerando relatório...";
  atualizarProgresso({ texto: "Preparando relatório...", percentual: 2 });
  limparMensagem(alerta);

  try {
    const { inicio, fimExclusivo } = intervaloMes(consultaAtual.ano, consultaAtual.mes);
    const atuais = await aplicarStatusExibido(
      await listarAtividadesDoPeriodo({
        contexto: contextoAtual,
        usuarioId: consultaAtual.usuarioId,
        inicio,
        fimExclusivo,
      })
    );
    const { concluidas } = classificarAtividades(atuais);
    const idsAntes = consultaAtual.concluidas.map((item) => item.id).sort().join(",");
    const idsAgora = concluidas.map((item) => item.id).sort().join(",");

    if (idsAntes !== idsAgora) {
      consultaAtual = { ...consultaAtual, concluidas };
      renderizarPrevia({
        mobilizadorNome: consultaAtual.mobilizadorNome,
        mes: consultaAtual.mes,
        ano: consultaAtual.ano,
        concluidas,
        rascunhos: consultaAtual.rascunhos,
        canceladas: consultaAtual.canceladas,
      });
      throw new Error("Os dados do período foram alterados. Consulte novamente antes de gerar o relatório.");
    }

    await gerarRelatorioMensalWord({
      atividadesPreview: concluidas,
      mobilizadorNome: consultaAtual.mobilizadorNome,
      periodoExtenso: periodoExtenso(consultaAtual.mes, consultaAtual.ano),
      mes: consultaAtual.mes,
      ano: consultaAtual.ano,
      onProgresso: atualizarProgresso,
    });
  } catch (erro) {
    console.error("Relatório mensal:", erro);
    exibirMensagem(alerta, "erro", mensagemErroRelatorioWord(erro));
  } finally {
    definirGerando(false);
    botao.textContent = "Gerar Relatório Mensal Word";
    botao.disabled = !consultaAtual?.concluidas?.length;
    atualizarProgresso({ texto: "", percentual: 0 });
    document.getElementById("progresso-relatorio").hidden = true;
  }
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

    const agora = new Date();
    const params = obterParametrosConsulta();
    const periodoInicial = sanitizarPeriodo(params.get("mes"), params.get("ano")) || {
      mes: agora.getMonth() + 1,
      ano: agora.getFullYear(),
    };

    preencherMeses(periodoInicial.mes);

    const admin = ehAdministrador(contextoAtual.perfil);
    const campoMobilizador = document.getElementById("campo-mobilizador");
    const campoNome = document.getElementById("campo-nome-mobilizador");
    const nomeMobilizador = document.getElementById("nome-mobilizador");
    campoMobilizador.hidden = !admin;
    campoNome.hidden = admin;

    if (admin) {
      const auxiliar = document.querySelector(".saudacao p");
      if (auxiliar) {
        auxiliar.textContent =
          "Gere o relatório consolidado das atividades de um mobilizador em determinado mês.";
      }
    }

    if (!admin) {
      nomeMobilizador.value = contextoAtual.perfil.nome || "—";
      await atualizarAnos(contextoAtual.usuario.id, periodoInicial.ano);
    } else {
      const seletor = document.getElementById("filtro-mobilizador");
      const mobilizadores = await listarMobilizadoresRelatorio();
      mobilizadores.forEach((item) => {
        const opcao = document.createElement("option");
        opcao.value = item.id;
        opcao.dataset.nome = item.nome || "";
        opcao.textContent =
          item.status === STATUS_USUARIO.INATIVO ? `${item.nome} — Inativo` : item.nome;
        seletor.append(opcao);
      });

      const solicitado = params.get("mobilizador");
      if (ehUuid(solicitado) && mobilizadores.some((item) => item.id === solicitado)) {
        seletor.value = solicitado;
      }

      await atualizarAnos(seletor.value || "", periodoInicial.ano);

      seletor.addEventListener("change", async () => {
        consultaAtual = null;
        document.getElementById("previa-relatorio").hidden = true;
        document.getElementById("botao-gerar").disabled = true;
        await atualizarAnos(seletor.value, Number(document.getElementById("filtro-ano").value));
      });
    }

    document.getElementById("form-relatorio-mensal").addEventListener("submit", consultar);
    document.getElementById("botao-gerar").addEventListener("click", gerar);

    if (!admin || ehUuid(usuarioAlvo())) {
      await consultar();
    }
  } catch (erro) {
    if (aviso) {
      aviso.hidden = false;
      aviso.textContent = erro.message;
    }
  }
}

iniciar();
