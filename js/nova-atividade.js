import {
  atualizarLegenda,
  atualizarOrdem,
  enviarFoto,
  formatarTamanhoArquivo,
  gerarUrlVisualizacao,
  listarFotos,
  mensagemErroFoto,
  removerFoto,
  validarArquivoCompleto,
} from "./atividade-fotos.js";
import {
  CLASSE_STATUS_ATIVIDADE,
  FOTOS,
  LIMITES_ATIVIDADE,
  ROTAS,
  ROTULO_STATUS_ATIVIDADE,
  STATUS_ATIVIDADE,
  urlNovaAtividade,
} from "./config.js";
import {
  atualizarAtividade,
  concluirAtividade,
  criarAtividade,
  mensagemErroAtividade,
  obterAtividade,
} from "./atividades.js";
import { ehAdministrador, protegerPagina } from "./guards.js";
import {
  atualizarNavegacao,
  configurarMenuMobile,
  configurarModulos,
  configurarSaida,
  preencherIdentidade,
} from "./layout.js";
import {
  contarCaracteres,
  dataHojeISO,
  definirTexto,
  exibirMensagem,
  limparMensagem,
  obterParametrosConsulta,
} from "./utils.js";

const CAMPOS_TEXTO = [
  { id: "introducao", minimo: LIMITES_ATIVIDADE.introducao, nome: "introdução" },
  { id: "descricao", minimo: LIMITES_ATIVIDADE.descricao, nome: "descrição da atividade" },
  { id: "conclusao", minimo: LIMITES_ATIVIDADE.conclusao, nome: "conclusão" },
];

let atividadeAtual = null;
let fotos = [];
let formularioSujo = false;
let salvando = false;
let enviandoFoto = false;
let podeEditarFotos = true;
let urlsVisualizacao = {};

function confirmarSaida() {
  if (!formularioSujo || salvando) {
    return true;
  }

  return window.confirm("Há alterações não salvas. Deseja sair sem salvar?");
}

function marcarSujo() {
  formularioSujo = true;
}

function limparSujo() {
  formularioSujo = false;
}

function ocupado() {
  return salvando || enviandoFoto;
}

function lerCampos() {
  return {
    data_atividade: document.getElementById("data-atividade").value,
    introducao: document.getElementById("introducao").value,
    descricao: document.getElementById("descricao").value,
    conclusao: document.getElementById("conclusao").value,
  };
}

function atualizarContador(id, minimo) {
  const campo = document.getElementById(id);
  const saida = document.getElementById(`contador-${id}`);

  if (!campo || !saida) {
    return;
  }

  const atual = contarCaracteres(campo.value);
  const faltam = Math.max(0, minimo - atual);

  saida.textContent =
    faltam > 0
      ? `${atual} / ${minimo} caracteres mínimos. Faltam ${faltam} caracteres.`
      : `${atual} / ${minimo} caracteres mínimos. Mínimo atingido.`;

  saida.classList.toggle("contador--ok", faltam === 0);
  saida.classList.toggle("contador--falta", faltam > 0);
}

function atualizarContadores() {
  CAMPOS_TEXTO.forEach(({ id, minimo }) => atualizarContador(id, minimo));
}

function validarConclusao() {
  const campos = lerCampos();

  for (const item of CAMPOS_TEXTO) {
    const atual = contarCaracteres(campos[item.id]);
    if (atual < item.minimo) {
      return `A ${item.nome} deve possuir pelo menos ${item.minimo} caracteres. Faltam ${item.minimo - atual} caracteres.`;
    }
  }

  if (fotos.length < 1) {
    return "Adicione pelo menos uma fotografia antes de concluir a atividade.";
  }

  return null;
}

function preencherFormulario(atividade) {
  document.getElementById("data-atividade").value = atividade.data_atividade || dataHojeISO();
  document.getElementById("introducao").value = atividade.introducao || "";
  document.getElementById("descricao").value = atividade.descricao || "";
  document.getElementById("conclusao").value = atividade.conclusao || "";
  atualizarStatus(atividade.status);
  atualizarContadores();
}

function atualizarStatus(status) {
  const selo = document.getElementById("status-atividade");
  if (!selo) {
    return;
  }

  selo.className = CLASSE_STATUS_ATIVIDADE[status] || "status";
  selo.textContent = ROTULO_STATUS_ATIVIDADE[status] || status;
}

function definirSomenteLeitura(ativo, motivo) {
  const form = document.getElementById("form-atividade");
  const aviso = document.getElementById("aviso-somente-leitura");
  const acoesEdicao = document.getElementById("acoes-edicao");

  ["data-atividade", "introducao", "descricao", "conclusao"].forEach((id) => {
    const campo = document.getElementById(id);
    if (campo) {
      campo.readOnly = ativo;
      campo.disabled = ativo && id === "data-atividade";
    }
  });

  if (acoesEdicao) {
    acoesEdicao.hidden = ativo;
  }

  if (aviso) {
    aviso.hidden = !ativo;
    if (ativo && motivo) {
      aviso.textContent = motivo;
    }
  }

  form?.classList.toggle("formulario--somente-leitura", ativo);
}

function atualizarTitulo(atividade) {
  const titulo = document.getElementById("titulo-pagina");
  if (!titulo) {
    return;
  }

  if (!atividade) {
    titulo.textContent = "Nova Atividade";
    return;
  }

  if (atividade.status === STATUS_ATIVIDADE.CONCLUIDA) {
    titulo.textContent = "Visualizar Atividade";
    return;
  }

  titulo.textContent = "Editar Atividade";
}

function registrarUrl(id) {
  const destino = urlNovaAtividade(id);
  window.history.replaceState({}, "", destino);
}

function aplicarEstadoInterface({ usuario, perfil }, atividade) {
  atualizarTitulo(atividade);

  const ehDono = !atividade || atividade.usuario_id === usuario.id;
  const admin = ehAdministrador(perfil);
  const concluida = atividade?.status === STATUS_ATIVIDADE.CONCLUIDA;
  const cancelada = atividade?.status === STATUS_ATIVIDADE.CANCELADA;

  if (atividade && !ehDono && !admin) {
    definirSomenteLeitura(true, "Você não possui permissão para editar esta atividade.");
    podeEditarFotos = false;
    atualizarInterfaceFotos();
    return;
  }

  if (cancelada) {
    definirSomenteLeitura(
      true,
      "Esta atividade foi cancelada administrativamente e está disponível somente para consulta."
    );
    podeEditarFotos = false;
    atualizarInterfaceFotos();
    return;
  }

  if (!admin && concluida) {
    definirSomenteLeitura(
      true,
      "Esta atividade foi concluída e não pode mais ser editada. Caso seja necessária alguma alteração, solicite a reabertura ao administrador."
    );
    podeEditarFotos = false;
    atualizarInterfaceFotos();
    return;
  }

  definirSomenteLeitura(false);
  podeEditarFotos = true;

  const botaoConcluir = document.getElementById("botao-concluir");
  const botaoSalvar = document.getElementById("botao-salvar");

  if (botaoConcluir) {
    botaoConcluir.hidden = Boolean(concluida);
  }

  if (botaoSalvar) {
    botaoSalvar.textContent = concluida && admin ? "Salvar alterações" : "Salvar Rascunho";
  }

  atualizarInterfaceFotos();
}

function definirBotoesOcupados(ocupadoAgora, rotulo) {
  salvando = ocupadoAgora;
  ["botao-salvar", "botao-concluir", "botao-cancelar"].forEach((id) => {
    const botao = document.getElementById(id);
    if (botao && id !== "botao-cancelar") {
      botao.disabled = ocupadoAgora || enviandoFoto;
    }
  });

  const botaoSalvar = document.getElementById("botao-salvar");
  const botaoConcluir = document.getElementById("botao-concluir");

  if (ocupadoAgora && rotulo === "salvar" && botaoSalvar) {
    botaoSalvar.textContent = "Salvando...";
  }

  if (ocupadoAgora && rotulo === "concluir" && botaoConcluir) {
    botaoConcluir.textContent = "Concluindo...";
  }

  if (!ocupadoAgora) {
    const concluida = atividadeAtual?.status === STATUS_ATIVIDADE.CONCLUIDA;
    if (botaoSalvar) {
      botaoSalvar.textContent = concluida ? "Salvar alterações" : "Salvar Rascunho";
    }
    if (botaoConcluir) {
      botaoConcluir.textContent = "Concluir Atividade";
    }
  }

  atualizarInterfaceFotos();
}

function escaparHtml(texto) {
  return String(texto || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function atualizarInterfaceFotos() {
  const indicador = document.getElementById("indicador-fotos");
  const botao = document.getElementById("botao-adicionar-foto");
  const avisoLimite = document.getElementById("aviso-limite-fotos");
  const statusEnvio = document.getElementById("status-envio-foto");
  const limiteAtingido = fotos.length >= FOTOS.maxPorAtividade;

  if (indicador) {
    indicador.textContent = `${fotos.length} de ${FOTOS.maxPorAtividade} fotos`;
  }

  if (botao) {
    botao.disabled = !podeEditarFotos || enviandoFoto || salvando || limiteAtingido;
    botao.hidden = !podeEditarFotos;
  }

  if (avisoLimite) {
    avisoLimite.hidden = !podeEditarFotos || !limiteAtingido;
  }

  if (statusEnvio) {
    statusEnvio.hidden = !enviandoFoto;
  }
}

function montarCartaoFoto(foto, indice) {
  const url = urlsVisualizacao[foto.id] || "";
  const legenda = foto.legenda || "";
  const acoes = podeEditarFotos
    ? `
      <div class="cartao-foto__acoes">
        <button class="botao botao--texto" type="button" data-foto-acao="subir" data-foto-id="${foto.id}" ${indice === 0 || enviandoFoto ? "disabled" : ""}>
          Mover para cima
        </button>
        <button class="botao botao--texto" type="button" data-foto-acao="descer" data-foto-id="${foto.id}" ${indice === fotos.length - 1 || enviandoFoto ? "disabled" : ""}>
          Mover para baixo
        </button>
        <button class="botao botao--texto" type="button" data-foto-acao="remover" data-foto-id="${foto.id}" ${enviandoFoto ? "disabled" : ""}>
          Remover
        </button>
      </div>
      <div class="campo">
        <label for="legenda-${foto.id}">Legenda da foto (opcional)</label>
        <textarea
          id="legenda-${foto.id}"
          data-foto-campo="legenda"
          data-foto-id="${foto.id}"
          maxlength="${FOTOS.maxLegenda}"
          rows="3"
          placeholder="Ex.: Reunião com representantes da cooperativa."
        >${escaparHtml(legenda)}</textarea>
        <p class="contador" data-contador-legenda="${foto.id}">${legenda.length} / ${FOTOS.maxLegenda}</p>
      </div>
    `
    : `
      <p class="campo-ajuda">${legenda ? escaparHtml(legenda) : "Sem legenda."}</p>
    `;

  return `
    <article class="cartao-foto" data-foto-id="${foto.id}">
      <div class="cartao-foto__miniatura">
        ${url ? `<img src="${escaparHtml(url)}" alt="${escaparHtml(legenda ? `Foto ${foto.ordem} — ${legenda}` : `Fotografia ${foto.ordem}`)}" />` : "<span>Sem preview</span>"}
      </div>
      <div class="cartao-foto__corpo">
        <strong class="cartao-foto__nome">${escaparHtml(foto.nome_arquivo)}</strong>
        <div class="cartao-foto__meta">
          <span>Ordem ${foto.ordem}</span>
          <span>${formatarTamanhoArquivo(foto.tamanho_bytes)}</span>
        </div>
        ${acoes}
      </div>
    </article>
  `;
}

async function atualizarUrlsVisualizacao() {
  const entradas = await Promise.all(
    fotos.map(async (foto) => [foto.id, await gerarUrlVisualizacao(foto.storage_path)])
  );
  urlsVisualizacao = Object.fromEntries(entradas);
}

async function renderizarFotos() {
  const lista = document.getElementById("lista-fotos");
  if (!lista) {
    return;
  }

  lista.innerHTML = fotos.map((foto, indice) => montarCartaoFoto(foto, indice)).join("");
  atualizarInterfaceFotos();
}

async function carregarFotos() {
  if (!atividadeAtual?.id) {
    fotos = [];
    urlsVisualizacao = {};
    await renderizarFotos();
    return;
  }

  fotos = await listarFotos(atividadeAtual.id);
  await atualizarUrlsVisualizacao();
  await renderizarFotos();
}

async function persistirRascunho(contexto) {
  if (atividadeAtual?.status === STATUS_ATIVIDADE.CANCELADA) {
    throw new Error("Atividade cancelada não pode ser alterada.");
  }

  const campos = lerCampos();

  if (!campos.data_atividade) {
    throw new Error("Informe a data da atividade.");
  }

  if (!atividadeAtual) {
    atividadeAtual = await criarAtividade({ usuario: contexto.usuario, campos });
    registrarUrl(atividadeAtual.id);
    return atividadeAtual;
  }

  atividadeAtual = await atualizarAtividade(atividadeAtual.id, campos);
  return atividadeAtual;
}

async function garantirRascunho(contexto) {
  if (atividadeAtual?.id) {
    return atividadeAtual;
  }

  atividadeAtual = await persistirRascunho(contexto);
  limparSujo();
  atualizarStatus(atividadeAtual.status);
  aplicarEstadoInterface(contexto, atividadeAtual);
  return atividadeAtual;
}

async function persistirLegendasPendentes() {
  if (!podeEditarFotos) {
    return;
  }

  const campos = document.querySelectorAll("[data-foto-campo='legenda']");

  for (const campo of campos) {
    const foto = fotos.find((item) => item.id === campo.dataset.fotoId);
    const atual = String(campo.value || "").trim();
    const anterior = String(foto?.legenda || "").trim();

    if (!foto || atual === anterior) {
      continue;
    }

    const atualizada = await atualizarLegenda(foto.id, atual);
    Object.assign(foto, atualizada);
  }
}

async function processarArquivos(contexto, arquivos) {
  const alerta = document.getElementById("alerta");
  const selecionados = [...arquivos].filter(Boolean);

  if (!selecionados.length || ocupado()) {
    return;
  }

  if (!podeEditarFotos) {
    exibirMensagem(
      alerta,
      "erro",
      "Você não possui permissão para alterar as fotografias desta atividade."
    );
    return;
  }

  const restantes = FOTOS.maxPorAtividade - fotos.length;
  if (restantes <= 0) {
    exibirMensagem(alerta, "erro", "Esta atividade já possui o máximo de 3 fotografias.");
    return;
  }

  limparMensagem(alerta);

  if (selecionados.length > restantes) {
    exibirMensagem(alerta, "erro", "Esta atividade já possui o máximo de 3 fotografias.");
  }

  const fila = selecionados.slice(0, restantes);

  for (const arquivo of fila) {
    const validacao = await validarArquivoCompleto(arquivo);
    if (!validacao.ok) {
      exibirMensagem(alerta, "erro", validacao.mensagem);
      return;
    }
  }

  enviandoFoto = true;
  definirBotoesOcupados(salvando);
  atualizarInterfaceFotos();

  try {
    await garantirRascunho(contexto);

    for (const arquivo of fila) {
      const validacao = await validarArquivoCompleto(arquivo);
      if (!validacao.ok) {
        exibirMensagem(alerta, "erro", validacao.mensagem);
        break;
      }

      const foto = await enviarFoto({
        atividade: atividadeAtual,
        arquivo,
        ordem: fotos.length + 1,
        mime: validacao.mime,
        extensao: validacao.extensao,
      });

      const url = await gerarUrlVisualizacao(foto.storage_path);
      fotos.push(foto);
      urlsVisualizacao[foto.id] = url;
      await renderizarFotos();
    }
  } catch (erro) {
    exibirMensagem(alerta, "erro", mensagemErroFoto(erro));
  } finally {
    enviandoFoto = false;
    definirBotoesOcupados(false);
    atualizarInterfaceFotos();
    const input = document.getElementById("input-fotos");
    if (input) {
      input.value = "";
    }
  }
}

async function reorganizarLista(ids) {
  await atualizarOrdem(atividadeAtual.id, ids);
  await carregarFotos();
}

async function iniciar() {
  const aviso = document.getElementById("aviso-configuracao");
  const alerta = document.getElementById("alerta");
  const form = document.getElementById("form-atividade");

  try {
    const contexto = await protegerPagina();
    if (!contexto) {
      return;
    }

    preencherIdentidade(contexto);
    atualizarNavegacao(contexto.perfil);
    configurarMenuMobile();
    configurarSaida({ confirmar: confirmarSaida });
    configurarModulos({ confirmar: confirmarSaida });

    definirTexto(document.getElementById("responsavel-nome"), contexto.perfil.nome || contexto.usuario.email);
    document.getElementById("data-atividade").value = dataHojeISO();
    atualizarStatus(STATUS_ATIVIDADE.RASCUNHO);
    atualizarContadores();
    atualizarInterfaceFotos();

    const id = obterParametrosConsulta().get("id");

    if (id) {
      const atividade = await obterAtividade(id);

      if (!atividade) {
        exibirMensagem(
          alerta,
          "erro",
          "Atividade não encontrada ou você não possui acesso a ela."
        );
        form.hidden = true;
        return;
      }

      atividadeAtual = atividade;
      preencherFormulario(atividade);
      aplicarEstadoInterface(contexto, atividade);
      try {
        await carregarFotos();
      } catch (erro) {
        exibirMensagem(alerta, "erro", mensagemErroAtividade(erro));
      }
    } else {
      aplicarEstadoInterface(contexto, null);
    }

    form.addEventListener("input", (evento) => {
      if (evento.target.matches("[data-foto-campo], #input-fotos")) {
        const contador = document.querySelector(`[data-contador-legenda="${evento.target.dataset.fotoId}"]`);
        if (contador) {
          contador.textContent = `${evento.target.value.length} / ${FOTOS.maxLegenda}`;
        }
        return;
      }

      marcarSujo();
      atualizarContadores();
    });

    form.addEventListener("focusout", async (evento) => {
      if (!evento.target.matches("[data-foto-campo='legenda']") || ocupado()) {
        return;
      }

      const foto = fotos.find((item) => item.id === evento.target.dataset.fotoId);
      const atual = String(evento.target.value || "").trim();
      const anterior = String(foto?.legenda || "").trim();

      if (!foto || atual === anterior) {
        return;
      }

      try {
        const atualizada = await atualizarLegenda(foto.id, atual);
        Object.assign(foto, atualizada);
      } catch (erro) {
        exibirMensagem(alerta, "erro", mensagemErroFoto(erro));
      }
    });

    form.addEventListener("click", async (evento) => {
      const botao = evento.target.closest("[data-foto-acao]");
      if (!botao || ocupado()) {
        return;
      }

      const fotoId = botao.dataset.fotoId;
      const foto = fotos.find((item) => item.id === fotoId);
      if (!foto) {
        return;
      }

      if (!podeEditarFotos) {
        exibirMensagem(
          alerta,
          "erro",
          "Você não possui permissão para alterar as fotografias desta atividade."
        );
        return;
      }

      if (botao.dataset.fotoAcao === "remover") {
        if (!window.confirm("Deseja remover esta fotografia?")) {
          return;
        }

        try {
          await removerFoto(foto);
          const restantes = fotos.filter((item) => item.id !== fotoId).map((item) => item.id);
          if (restantes.length) {
            await reorganizarLista(restantes);
          } else {
            fotos = [];
            urlsVisualizacao = {};
            await renderizarFotos();
          }
        } catch (erro) {
          exibirMensagem(alerta, "erro", "Não foi possível remover a fotografia.");
        }
        return;
      }

      const indice = fotos.findIndex((item) => item.id === fotoId);
      const destino = botao.dataset.fotoAcao === "subir" ? indice - 1 : indice + 1;
      if (destino < 0 || destino >= fotos.length) {
        return;
      }

      const ids = fotos.map((item) => item.id);
      [ids[indice], ids[destino]] = [ids[destino], ids[indice]];

      try {
        await reorganizarLista(ids);
      } catch (erro) {
        exibirMensagem(alerta, "erro", mensagemErroFoto(erro));
      }
    });

    document.getElementById("botao-adicionar-foto")?.addEventListener("click", () => {
      if (!podeEditarFotos || ocupado() || fotos.length >= FOTOS.maxPorAtividade) {
        return;
      }

      document.getElementById("input-fotos")?.click();
    });

    document.getElementById("input-fotos")?.addEventListener("change", (evento) => {
      processarArquivos(contexto, evento.target.files || []);
    });

    const zona = document.getElementById("registro-fotografico");
    zona?.addEventListener("dragover", (evento) => {
      if (!podeEditarFotos || ocupado()) {
        return;
      }

      evento.preventDefault();
      zona.classList.add("registro-fotografico--arraste");
    });
    zona?.addEventListener("dragleave", () => {
      zona.classList.remove("registro-fotografico--arraste");
    });
    zona?.addEventListener("drop", (evento) => {
      evento.preventDefault();
      zona.classList.remove("registro-fotografico--arraste");
      processarArquivos(contexto, evento.dataTransfer?.files || []);
    });

    form.addEventListener("submit", async (evento) => {
      evento.preventDefault();
      if (ocupado()) {
        return;
      }
      limparMensagem(alerta);

      definirBotoesOcupados(true, "salvar");

      try {
        if (atividadeAtual?.status === STATUS_ATIVIDADE.CONCLUIDA) {
          const erroValidacao = validarConclusao();
          if (erroValidacao) {
            throw new Error(erroValidacao);
          }
        }

        await persistirRascunho(contexto);
        await persistirLegendasPendentes();
        limparSujo();
        aplicarEstadoInterface(contexto, atividadeAtual);
        atualizarStatus(atividadeAtual.status);
        const mensagem =
          atividadeAtual.status === STATUS_ATIVIDADE.CONCLUIDA
            ? "Alterações salvas com sucesso."
            : "Rascunho salvo com sucesso.";
        exibirMensagem(alerta, "sucesso", mensagem);
        alerta.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (erro) {
        exibirMensagem(alerta, "erro", mensagemErroAtividade(erro));
      } finally {
        definirBotoesOcupados(false);
      }
    });

    document.getElementById("botao-concluir")?.addEventListener("click", async () => {
      if (ocupado()) {
        return;
      }
      if (atividadeAtual?.status === STATUS_ATIVIDADE.CANCELADA) {
        exibirMensagem(alerta, "erro", "Atividade cancelada não pode ser alterada.");
        return;
      }
      limparMensagem(alerta);

      const erroValidacao = validarConclusao();
      if (erroValidacao) {
        exibirMensagem(alerta, "erro", erroValidacao);
        alerta.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }

      definirBotoesOcupados(true, "concluir");

      try {
        if (!atividadeAtual) {
          await persistirRascunho(contexto);
        }

        await persistirLegendasPendentes();
        atividadeAtual = await concluirAtividade(atividadeAtual.id, lerCampos());
        limparSujo();
        aplicarEstadoInterface(contexto, atividadeAtual);
        atualizarStatus(atividadeAtual.status);
        await carregarFotos();
        exibirMensagem(alerta, "sucesso", "Atividade concluída com sucesso.");
        alerta.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (erro) {
        exibirMensagem(alerta, "erro", mensagemErroAtividade(erro));
      } finally {
        definirBotoesOcupados(false);
      }
    });

    document.getElementById("botao-cancelar")?.addEventListener("click", () => {
      if (!confirmarSaida()) {
        return;
      }

      window.location.assign(ROTAS.dashboard);
    });

    window.addEventListener("beforeunload", (evento) => {
      if (!formularioSujo || salvando) {
        return;
      }

      evento.preventDefault();
      evento.returnValue = "";
    });
  } catch (erro) {
    if (aviso) {
      aviso.hidden = false;
      aviso.textContent = erro.message || mensagemErroAtividade(erro);
    }
  }
}

iniciar();
