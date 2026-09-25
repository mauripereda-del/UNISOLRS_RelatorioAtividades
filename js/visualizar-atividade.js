import { listarAuditoriaAtividade } from "./auditoria.js";
import { gerarUrlVisualizacao, listarFotos } from "./atividade-fotos.js";
import {
  atualizarContadorCancelamento,
  cancelarAtividade,
  formatarDataCancelamento,
  mensagemErroCancelamento,
  obterInformacoesCancelamento,
  podeCancelarAtividade,
  resumoAtividadeCancelamento,
  rotuloStatusAtual,
} from "./cancelamento.js";
import {
  CANCELAMENTO,
  CLASSE_STATUS_EXIBIDO,
  CLASSE_STATUS_SOLICITACAO,
  REABERTURA,
  ROTAS,
  ROTULO_STATUS_EXIBIDO,
  ROTULO_STATUS_SOLICITACAO,
  STATUS_ATIVIDADE,
  STATUS_SOLICITACAO,
  urlNovaAtividade,
} from "./config.js";
import { ehUuid, mensagemErroAtividade, obterAtividadeDetalhada, podeEditarAtividade } from "./atividades.js";
import { ehAdministrador, ehMobilizador, protegerPagina } from "./guards.js";
import {
  complementoStatusExibido,
  listarSolicitacoesDaAtividade,
  mensagemErroReabertura,
  obterStatusExibido,
  obterUltimasSolicitacoesPorAtividades,
  solicitarReabertura,
} from "./reabertura.js";
import { gerarRelatorioWord, mensagemErroRelatorioWord } from "./relatorio-word.js";
import {
  atualizarNavegacao,
  configurarMenuMobile,
  configurarModulos,
  configurarSaida,
  preencherIdentidade,
} from "./layout.js";
import {
  definirTexto,
  exibirMensagem,
  formatarDataCivil,
  formatarDataHora,
  limparMensagem,
  obterParametrosConsulta,
} from "./utils.js";

const CHAVES_RETORNO = new Set([
  "inicio",
  "fim",
  "status",
  "mobilizador",
  "perfil",
  "busca",
  "ordenacao",
  "pagina",
]);

function urlHistoricoSegura(retorno) {
  const origem = new URLSearchParams(retorno || "");

  if (origem.get("origem") === "relatorio-mensal") {
    const limpa = new URLSearchParams();
    const mes = Number(origem.get("mes"));
    const ano = Number(origem.get("ano"));

    if (Number.isInteger(mes) && mes >= 1 && mes <= 12) {
      limpa.set("mes", String(mes));
    }

    if (Number.isInteger(ano) && ano >= 2000 && ano <= 2100) {
      limpa.set("ano", String(ano));
    }

    if (ehUuid(origem.get("mobilizador"))) {
      limpa.set("mobilizador", origem.get("mobilizador"));
    }

    const consulta = limpa.toString();
    return consulta ? `${ROTAS.relatorioMensal}?${consulta}` : ROTAS.relatorioMensal;
  }

  const limpa = new URLSearchParams();

  origem.forEach((valor, chave) => {
    if (CHAVES_RETORNO.has(chave) && valor) {
      limpa.set(chave, valor);
    }
  });

  const consulta = limpa.toString();
  return consulta ? `${ROTAS.historico}?${consulta}` : ROTAS.historico;
}

function definirTextoPreservado(id, texto) {
  const elemento = document.getElementById(id);
  if (!elemento) {
    return;
  }

  elemento.textContent = texto?.trim() ? texto : "—";
}

function abrirFoto(foto, url) {
  const dialogo = document.getElementById("dialogo-foto");
  const imagem = document.getElementById("foto-ampliada");
  const legenda = document.getElementById("legenda-ampliada");
  const titulo = document.getElementById("titulo-foto-ampliada");

  imagem.src = url;
  imagem.alt = foto.legenda || `Fotografia ${foto.ordem}`;
  titulo.textContent = foto.legenda ? "Fotografia" : `Fotografia ${foto.ordem}`;

  if (foto.legenda) {
    legenda.hidden = false;
    legenda.textContent = foto.legenda;
  } else {
    legenda.hidden = true;
    legenda.textContent = "";
  }

  dialogo.showModal();
  document.getElementById("fechar-foto")?.focus();
}

function fecharFoto() {
  const dialogo = document.getElementById("dialogo-foto");
  const imagem = document.getElementById("foto-ampliada");
  dialogo.close();
  imagem.removeAttribute("src");
  imagem.alt = "";
}

async function renderizarFotos(atividadeId) {
  const galeria = document.getElementById("galeria-fotos");
  const vazio = document.getElementById("fotos-vazias");
  galeria.replaceChildren();

  const fotos = await listarFotos(atividadeId);

  if (!fotos.length) {
    vazio.hidden = false;
    return;
  }

  vazio.hidden = true;

  for (const foto of fotos) {
    const url = await gerarUrlVisualizacao(foto.storage_path);
    const figura = document.createElement("figure");
    figura.className = "galeria-fotos__item";

    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "galeria-fotos__botao";
    botao.setAttribute("aria-label", foto.legenda || `Ampliar fotografia ${foto.ordem}`);

    if (url) {
      const imagem = document.createElement("img");
      imagem.src = url;
      imagem.alt = foto.legenda || `Fotografia ${foto.ordem}`;
      botao.append(imagem);
    } else {
      botao.textContent = "Preview indisponível";
    }

    botao.addEventListener("click", () => {
      if (url) {
        abrirFoto(foto, url);
      }
    });

    figura.append(botao);

    if (foto.legenda) {
      const caption = document.createElement("figcaption");
      caption.textContent = foto.legenda;
      figura.append(caption);
    }

    galeria.append(figura);
  }
}

async function iniciar() {
  const aviso = document.getElementById("aviso-configuracao");
  const alerta = document.getElementById("alerta");

  try {
    const contexto = await protegerPagina();
    if (!contexto) {
      return;
    }

    preencherIdentidade(contexto);
    atualizarNavegacao(contexto.perfil);
    configurarMenuMobile();
    configurarSaida();
    configurarModulos();

    const params = obterParametrosConsulta();
    const id = params.get("id");
    const retorno = urlHistoricoSegura(params.get("retorno") || "");
    document.getElementById("botao-voltar").href = retorno;
    if (String(params.get("retorno") || "").includes("origem=relatorio-mensal")) {
      document.getElementById("botao-voltar").textContent = "Voltar ao Relatório Mensal";
    }

    document.getElementById("fechar-foto")?.addEventListener("click", fecharFoto);
    document.getElementById("dialogo-foto")?.addEventListener("cancel", (evento) => {
      evento.preventDefault();
      fecharFoto();
    });

    if (!ehUuid(id)) {
      exibirMensagem(alerta, "erro", "Atividade não encontrada ou você não possui acesso a ela.");
      return;
    }

    const atividade = await obterAtividadeDetalhada(id);

    if (!atividade) {
      exibirMensagem(alerta, "erro", "Atividade não encontrada ou você não possui acesso a ela.");
      return;
    }

    limparMensagem(alerta);
    document.getElementById("detalhe-atividade").hidden = false;
    definirTexto(document.getElementById("detalhe-mobilizador"), atividade.responsavel || "—");
    definirTexto(document.getElementById("detalhe-data"), formatarDataCivil(atividade.data_atividade));
    definirTexto(document.getElementById("detalhe-criacao"), formatarDataHora(atividade.created_at));
    definirTexto(document.getElementById("detalhe-atualizacao"), formatarDataHora(atividade.updated_at));

    let ultimaSolicitacao = null;
    try {
      const ultimas = await obterUltimasSolicitacoesPorAtividades([atividade.id]);
      ultimaSolicitacao = ultimas[atividade.id] || null;
    } catch (_erro) {
      ultimaSolicitacao = null;
    }

    aplicarSituacaoExibida(atividade, ultimaSolicitacao);
    await renderizarCancelamento(atividade, ultimaSolicitacao);

    definirTextoPreservado("detalhe-introducao", atividade.introducao);
    definirTextoPreservado("detalhe-descricao", atividade.descricao);
    definirTextoPreservado("detalhe-conclusao", atividade.conclusao);

    const botaoEditar = document.getElementById("botao-editar");
    if (podeEditarAtividade(atividade, contexto.perfil, contexto.usuario)) {
      botaoEditar.hidden = false;
      botaoEditar.href = urlNovaAtividade(atividade.id);
    } else {
      botaoEditar.hidden = true;
    }

    const botaoCancelar = document.getElementById("botao-cancelar-atividade");
    if (botaoCancelar) {
      botaoCancelar.hidden = !podeCancelarAtividade(atividade, contexto.perfil);
    }

    await renderizarFotos(atividade.id);
    await renderizarReaberturas(atividade, contexto);
    if (ehAdministrador(contexto.perfil)) {
      await renderizarAuditoria(atividade.id);
    }
    const contextoRelatorio = { atividade, ultimaSolicitacao };
    configurarSolicitacao(atividade, contexto, alerta, contextoRelatorio);
    configurarCancelamento(atividade, ultimaSolicitacao, contexto, alerta, contextoRelatorio);
    configurarRelatorioWord(contextoRelatorio, alerta);
  } catch (erro) {
    console.error("Detalhe da atividade:", erro);
    if (aviso && !alerta) {
      aviso.hidden = false;
      aviso.textContent = erro.message;
    } else {
      exibirMensagem(alerta, "erro", mensagemErroAtividade(erro));
    }
  }
}

async function renderizarCancelamento(atividade, ultimaSolicitacao) {
  const aviso = document.getElementById("aviso-cancelada");
  const secao = document.getElementById("secao-cancelamento");
  const cancelada = atividade.status === STATUS_ATIVIDADE.CANCELADA;

  if (aviso) {
    aviso.hidden = !cancelada;
  }

  if (!secao) {
    return;
  }

  if (!cancelada) {
    secao.hidden = true;
    return;
  }

  let info = null;
  try {
    info = await obterInformacoesCancelamento(atividade.id);
  } catch (_erro) {
    info = {
      canceladaPorNome: "Administrador",
      dataHora: formatarDataCancelamento(atividade.cancelada_em),
      motivo: atividade.motivo_cancelamento || "",
    };
  }

  definirTexto(document.getElementById("cancelada-por"), info?.canceladaPorNome || "Administrador");
  definirTexto(document.getElementById("cancelada-em"), info?.dataHora || "—");
  definirTextoPreservado("cancelada-motivo", info?.motivo || atividade.motivo_cancelamento);
  secao.hidden = false;
  aplicarSituacaoExibida(atividade, ultimaSolicitacao);
}

function configurarRelatorioWord(ref, alerta) {
  const botao = document.getElementById("botao-relatorio-word");
  if (!botao) {
    return;
  }

  botao.addEventListener("click", async () => {
    if (botao.disabled) {
      return;
    }

    botao.disabled = true;
    botao.textContent = "Gerando relatório...";
    limparMensagem(alerta);

    try {
      await gerarRelatorioWord(ref.atividade, { ultimaSolicitacao: ref.ultimaSolicitacao });
    } catch (erro) {
      console.error("Relatório Word:", erro);
      exibirMensagem(alerta, "erro", mensagemErroRelatorioWord(erro));
    } finally {
      botao.disabled = false;
      botao.textContent = "Gerar Relatório Word";
    }
  });
}

function configurarCancelamento(atividade, ultimaSolicitacao, contexto, alerta, contextoRelatorio) {
  const dialogo = document.getElementById("dialogo-cancelar");
  const campo = document.getElementById("motivo-cancelamento");
  const contador = document.getElementById("contador-cancelamento");
  const confirmar = document.getElementById("confirmar-cancelamento");
  const enviar = document.getElementById("enviar-cancelamento");
  const botao = document.getElementById("botao-cancelar-atividade");

  if (!dialogo || !botao) {
    return;
  }

  const atualizarEnvio = () => {
    const motivoOk = atualizarContadorCancelamento(campo, contador);
    enviar.disabled = !motivoOk || !confirmar?.checked;
  };

  botao.addEventListener("click", () => {
    if (ultimaSolicitacao?.status === STATUS_SOLICITACAO.PENDENTE) {
      exibirMensagem(
        alerta,
        "erro",
        "Esta atividade possui uma solicitação de reabertura pendente. Analise a solicitação antes de cancelar a atividade."
      );
      return;
    }

    definirTexto(document.getElementById("cancelar-mobilizador"), atividade.responsavel || "—");
    definirTexto(document.getElementById("cancelar-data"), formatarDataCivil(atividade.data_atividade));
    definirTexto(
      document.getElementById("cancelar-status"),
      rotuloStatusAtual(atividade, obterStatusExibido(atividade, ultimaSolicitacao))
    );
    definirTexto(document.getElementById("cancelar-resumo"), resumoAtividadeCancelamento(atividade));
    campo.value = "";
    confirmar.checked = false;
    atualizarEnvio();
    dialogo.showModal();
    campo.focus();
  });

  document.getElementById("fechar-cancelamento")?.addEventListener("click", () => dialogo.close());
  campo?.addEventListener("input", atualizarEnvio);
  confirmar?.addEventListener("change", atualizarEnvio);

  enviar?.addEventListener("click", async () => {
    const motivo = campo.value.trim();
    if (motivo.length < CANCELAMENTO.motivoMinimo || motivo.length > CANCELAMENTO.motivoMaximo) {
      exibirMensagem(
        alerta,
        "erro",
        "Informe detalhadamente o motivo do cancelamento. O texto deve possuir pelo menos 50 caracteres."
      );
      return;
    }

    if (!confirmar.checked) {
      return;
    }

    enviar.disabled = true;
    enviar.textContent = "Cancelando...";
    botao.disabled = true;

    try {
      await cancelarAtividade(atividade.id, motivo);
      dialogo.close();
      const cancelada = {
        ...atividade,
        status: STATUS_ATIVIDADE.CANCELADA,
        motivo_cancelamento: motivo,
      };
      if (contextoRelatorio) {
        contextoRelatorio.atividade = cancelada;
      }
      aplicarSituacaoExibida(cancelada, ultimaSolicitacao);
      await renderizarCancelamento(cancelada, ultimaSolicitacao);
      botao.hidden = true;
      document.getElementById("botao-editar").hidden = true;
      document.getElementById("botao-solicitar-reabertura").hidden = true;
      document.getElementById("status-reabertura").hidden = true;
      if (ehAdministrador(contexto.perfil)) {
        await renderizarAuditoria(atividade.id);
      }
      exibirMensagem(alerta, "sucesso", "Atividade cancelada com sucesso.");
    } catch (erro) {
      console.error("Cancelar atividade:", erro);
      exibirMensagem(alerta, "erro", mensagemErroCancelamento(erro));
    } finally {
      enviar.disabled = false;
      enviar.textContent = "Confirmar Cancelamento";
      botao.disabled = false;
      atualizarEnvio();
    }
  });
}

function aplicarSituacaoExibida(atividade, ultimaSolicitacao) {
  const codigo = obterStatusExibido(atividade, ultimaSolicitacao);
  const status = document.getElementById("detalhe-status");
  const complemento = document.getElementById("detalhe-situacao-complemento");

  if (status) {
    status.className = CLASSE_STATUS_EXIBIDO[codigo] || "status";
    status.textContent = ROTULO_STATUS_EXIBIDO[codigo] || codigo;
  }

  if (complemento) {
    const texto = complementoStatusExibido(codigo);
    complemento.textContent = texto;
    complemento.hidden = !texto;
  }
}

function atualizarContadorMotivo(campo, contador) {
  const atual = campo.value.trim().length;
  const faltam = Math.max(0, REABERTURA.motivoMinimo - atual);

  contador.textContent =
    faltam > 0
      ? `${atual} / ${REABERTURA.motivoMinimo} caracteres mínimos. Faltam ${faltam} caracteres.`
      : `${atual} / ${REABERTURA.motivoMinimo} caracteres mínimos. Mínimo atingido.`;
  contador.classList.toggle("contador--ok", faltam === 0);
  contador.classList.toggle("contador--falta", faltam > 0);
}

async function renderizarReaberturas(atividade, contexto) {
  const lista = document.getElementById("lista-reaberturas");
  const vazio = document.getElementById("reaberturas-vazias");
  lista.replaceChildren();

  const solicitacoes = await listarSolicitacoesDaAtividade(atividade.id);
  const pendente = solicitacoes.find((item) => item.status === STATUS_SOLICITACAO.PENDENTE);
  const podeSolicitar =
    ehMobilizador(contexto.perfil) &&
    atividade.usuario_id === contexto.usuario.id &&
    atividade.status === STATUS_ATIVIDADE.CONCLUIDA &&
    !pendente;

  document.getElementById("botao-solicitar-reabertura").hidden = !podeSolicitar;
  document.getElementById("status-reabertura").hidden = !(
    ehMobilizador(contexto.perfil) &&
    atividade.usuario_id === contexto.usuario.id &&
    Boolean(pendente)
  );

  if (!solicitacoes.length) {
    vazio.hidden = false;
    return;
  }

  vazio.hidden = true;

  solicitacoes.forEach((item) => {
    const artigo = document.createElement("article");
    artigo.className = "item-reabertura";

    const topo = document.createElement("div");
    topo.className = "item-reabertura__topo";
    const data = document.createElement("strong");
    data.textContent = formatarDataHora(item.solicitado_em);
    const badge = document.createElement("span");
    badge.className = CLASSE_STATUS_SOLICITACAO[item.status] || "status";
    badge.textContent = ROTULO_STATUS_SOLICITACAO[item.status] || item.status;
    topo.append(data, badge);

    const motivo = document.createElement("p");
    motivo.textContent = item.motivo;

    artigo.append(topo, motivo);

    if (item.analisado_em) {
      const analise = document.createElement("p");
      analise.className = "item-reabertura__meta";
      const responsavel = item.analistaNome ? ` por ${item.analistaNome}` : "";
      analise.textContent = `Analisada em ${formatarDataHora(item.analisado_em)}${responsavel}`;
      artigo.append(analise);
    }

    if (item.observacao_admin) {
      const obs = document.createElement("p");
      obs.className = "item-reabertura__meta";
      obs.textContent = `Observação: ${item.observacao_admin}`;
      artigo.append(obs);
    }

    lista.append(artigo);
  });
}

async function renderizarAuditoria(atividadeId) {
  const secao = document.getElementById("secao-auditoria");
  const lista = document.getElementById("lista-auditoria");
  const vazio = document.getElementById("auditoria-vazia");
  secao.hidden = false;
  lista.replaceChildren();

  const eventos = await listarAuditoriaAtividade(atividadeId);

  if (!eventos.length) {
    vazio.hidden = false;
    return;
  }

  vazio.hidden = true;
  eventos.forEach((item) => {
    const artigo = document.createElement("article");
    artigo.className = "item-auditoria";

    const acao = document.createElement("strong");
    acao.textContent = item.acaoRotulo;

    const responsavel = document.createElement("p");
    responsavel.textContent = `Responsável: ${item.usuarioNome}`;

    const data = document.createElement("p");
    data.className = "item-reabertura__meta";
    data.textContent = formatarDataCancelamento(item.created_at);

    const resumo = document.createElement("p");
    resumo.className = "item-auditoria__resumo";
    resumo.textContent = item.resumo;

    artigo.append(acao, responsavel, data, resumo);
    lista.append(artigo);
  });
}

function configurarSolicitacao(atividade, contexto, alerta, contextoRelatorio) {
  const dialogo = document.getElementById("dialogo-solicitar");
  const campo = document.getElementById("motivo-reabertura");
  const contador = document.getElementById("contador-motivo");
  const enviar = document.getElementById("enviar-solicitacao");

  document.getElementById("botao-solicitar-reabertura")?.addEventListener("click", () => {
    campo.value = "";
    atualizarContadorMotivo(campo, contador);
    dialogo.showModal();
    campo.focus();
  });

  document.getElementById("cancelar-solicitacao")?.addEventListener("click", () => dialogo.close());

  campo?.addEventListener("input", () => atualizarContadorMotivo(campo, contador));

  enviar?.addEventListener("click", async () => {
    const motivo = campo.value.trim();
    if (motivo.length < REABERTURA.motivoMinimo || motivo.length > REABERTURA.motivoMaximo) {
      exibirMensagem(
        alerta,
        "erro",
        "Informe detalhadamente o motivo da reabertura. O motivo deve possuir pelo menos 50 caracteres."
      );
      return;
    }

    enviar.disabled = true;
    enviar.textContent = "Processando...";

    try {
      await solicitarReabertura(atividade.id, motivo);
      dialogo.close();
      exibirMensagem(alerta, "sucesso", "Solicitação de reabertura enviada com sucesso.");
      const atividadeAtualizada = { ...atividade, status: STATUS_ATIVIDADE.CONCLUIDA };
      await renderizarReaberturas(atividadeAtualizada, contexto);
      const solicitacaoPendente = { status: STATUS_SOLICITACAO.PENDENTE };
      if (contextoRelatorio) {
        contextoRelatorio.ultimaSolicitacao = solicitacaoPendente;
      }
      aplicarSituacaoExibida(atividadeAtualizada, solicitacaoPendente);
    } catch (erro) {
      console.error("Solicitar reabertura:", erro);
      exibirMensagem(alerta, "erro", mensagemErroReabertura(erro));
    } finally {
      enviar.disabled = false;
      enviar.textContent = "Enviar Solicitação";
    }
  });
}

iniciar();
