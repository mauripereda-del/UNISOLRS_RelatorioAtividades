import {
  atualizarUsuarioAdmin,
  chamarAdminUsuarios,
  ehUuidUsuario,
  mensagemErroAdminUsuarios,
  obterContagensUsuarios,
  obterUsuarioAdmin,
} from "./admin-usuarios.js";
import { listarAuditoriaUsuario } from "./auditoria.js";
import { PERFIS, ROTAS, STATUS_USUARIO, urlHistoricoUsuario } from "./config.js";
import { protegerPaginaAdmin } from "./guards.js";
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
  formatarDataHora,
  formatarNomePerfil,
  limparMensagem,
  obterParametrosConsulta,
} from "./utils.js";

let contextoAtual = null;
let usuarioAtual = null;
let operando = false;
let confirmacaoPendente = null;
let origemFoco = null;

const CHAVES_RETORNO_USUARIOS = new Set(["busca", "perfil", "status", "ordenacao", "pagina"]);

function urlListagem() {
  const origem = new URLSearchParams(obterParametrosConsulta().get("retorno") || "");
  const limpa = new URLSearchParams();

  origem.forEach((valor, chave) => {
    if (CHAVES_RETORNO_USUARIOS.has(chave) && valor) {
      limpa.set(chave, valor);
    }
  });

  const consulta = limpa.toString();
  return consulta ? `${ROTAS.usuarios}?${consulta}` : ROTAS.usuarios;
}

function abrirConfirmacao({ titulo, texto, perigo = true, onConfirmar, origem }) {
  confirmacaoPendente = onConfirmar;
  origemFoco = origem || document.activeElement;
  document.getElementById("titulo-confirmacao").textContent = titulo;
  document.getElementById("texto-confirmacao").textContent = texto;
  const botao = document.getElementById("botao-confirmar-acao");
  botao.className = perigo ? "botao botao--perigo" : "botao botao--primario";
  document.getElementById("dialogo-confirmacao").showModal();
  botao.focus();
}

function fecharConfirmacao() {
  document.getElementById("dialogo-confirmacao").close();
  origemFoco?.focus?.();
  origemFoco = null;
}

async function recarregar() {
  const params = obterParametrosConsulta();
  const id = params.get("id");
  if (!ehUuidUsuario(id)) {
    exibirMensagem(document.getElementById("alerta"), "erro", "Usuário inválido.");
    return;
  }

  usuarioAtual = await obterUsuarioAdmin(id);
  if (!usuarioAtual) {
    exibirMensagem(document.getElementById("alerta"), "erro", "Usuário não encontrado.");
    return;
  }

  const [contagens, auditoria] = await Promise.all([
    obterContagensUsuarios([usuarioAtual.id]),
    listarAuditoriaUsuario(usuarioAtual.id),
  ]);
  const stats = contagens[usuarioAtual.id] || { total: 0, rascunhos: 0, concluidas: 0, canceladas: 0 };

  definirTexto(document.getElementById("titulo-usuario"), usuarioAtual.nome || "Usuário");
  definirTexto(document.getElementById("dado-nome"), usuarioAtual.nome || "—");
  definirTexto(document.getElementById("dado-email"), usuarioAtual.email || "—");
  definirTexto(document.getElementById("dado-telefone"), usuarioAtual.telefone || "—");
  const perfilEl = document.getElementById("dado-perfil");
  const statusEl = document.getElementById("dado-status");
  perfilEl.replaceChildren();
  statusEl.replaceChildren();
  const badgePerfil = document.createElement("span");
  badgePerfil.className = `status ${usuarioAtual.perfil === PERFIS.ADMIN ? "status--admin" : "status--mobilizador"}`;
  badgePerfil.textContent = formatarNomePerfil(usuarioAtual.perfil);
  const badgeStatus = document.createElement("span");
  badgeStatus.className = `status ${usuarioAtual.status === STATUS_USUARIO.ATIVO ? "status--ativo" : "status--inativo"}`;
  badgeStatus.textContent = usuarioAtual.status === STATUS_USUARIO.ATIVO ? "Ativo" : "Inativo";
  perfilEl.append(badgePerfil);
  statusEl.append(badgeStatus);
  definirTexto(document.getElementById("dado-cadastro"), formatarDataHora(usuarioAtual.created_at));
  definirTexto(document.getElementById("dado-atualizacao"), formatarDataHora(usuarioAtual.updated_at));
  definirTexto(document.getElementById("stat-total"), String(stats.total));
  definirTexto(document.getElementById("stat-rascunhos"), String(stats.rascunhos));
  definirTexto(document.getElementById("stat-concluidas"), String(stats.concluidas));
  definirTexto(document.getElementById("stat-canceladas"), String(stats.canceladas));

  const acoes = document.getElementById("acoes-detalhe");
  acoes.replaceChildren();

  const historico = document.createElement("a");
  historico.className = "botao botao--secundario";
  historico.href = urlHistoricoUsuario(usuarioAtual.id);
  historico.textContent = "Ver atividades deste usuário";
  acoes.append(historico);

  const proprio = usuarioAtual.id === contextoAtual.usuario.id;
  if (!proprio) {
    const status = document.createElement("button");
    status.className = usuarioAtual.status === STATUS_USUARIO.ATIVO ? "botao botao--perigo" : "botao botao--primario";
    status.type = "button";
    status.textContent = usuarioAtual.status === STATUS_USUARIO.ATIVO ? "Inativar usuário" : "Ativar usuário";
    status.addEventListener("click", () => pedirStatus(status));
    acoes.append(status);
  }

  const senha = document.createElement("button");
  senha.className = "botao botao--secundario";
  senha.type = "button";
  senha.textContent = "Enviar redefinição de senha";
  senha.addEventListener("click", () => pedirSenha(senha));
  acoes.append(senha);

  const corpo = document.getElementById("corpo-auditoria");
  const tabela = document.getElementById("tabela-auditoria-envoltorio");
  const vazia = document.getElementById("auditoria-vazia");
  corpo.replaceChildren();

  if (!auditoria.length) {
    tabela.hidden = true;
    vazia.hidden = false;
    return;
  }

  vazia.hidden = true;
  tabela.hidden = false;
  auditoria.forEach((item) => {
    const linha = document.createElement("tr");
    [formatarDataHora(item.created_at), item.usuarioNome, item.acaoRotulo, item.resumo].forEach((valor) => {
      const td = document.createElement("td");
      td.textContent = valor;
      linha.append(td);
    });
    corpo.append(linha);
  });
}

function pedirStatus(origem) {
  const ativar = usuarioAtual.status !== STATUS_USUARIO.ATIVO;
  abrirConfirmacao({
    titulo: ativar ? "Ativar usuário" : "Inativar usuário",
    texto: ativar
      ? `Deseja ativar o acesso de ${usuarioAtual.nome} ao sistema?`
      : "O usuário perderá o acesso ao sistema, mas seu histórico será preservado. Deseja continuar?",
    perigo: !ativar,
    origem,
    onConfirmar: async () => {
      await atualizarUsuarioAdmin({
        id: usuarioAtual.id,
        nome: usuarioAtual.nome,
        telefone: usuarioAtual.telefone,
        perfil: usuarioAtual.perfil,
        status: ativar ? STATUS_USUARIO.ATIVO : STATUS_USUARIO.INATIVO,
        updated_at: usuarioAtual.updated_at,
      });
      exibirMensagem(
        document.getElementById("alerta"),
        "sucesso",
        ativar ? "Usuário ativado com sucesso." : "Usuário inativado. O histórico foi preservado."
      );
      await recarregar();
    },
  });
}

function pedirSenha(origem) {
  abrirConfirmacao({
    titulo: "Enviar redefinição de senha",
    texto: `Enviar instruções de redefinição de senha para ${usuarioAtual.email}?`,
    perigo: false,
    origem,
    onConfirmar: async () => {
      const resposta = await chamarAdminUsuarios("ENVIAR_RECUPERACAO", { id: usuarioAtual.id });
      exibirMensagem(
        document.getElementById("alerta"),
        "sucesso",
        resposta?.mensagem || "As instruções para definição da senha foram enviadas para o e-mail informado."
      );
    },
  });
}

async function confirmarAcao() {
  if (!confirmacaoPendente || operando) {
    return;
  }

  const botao = document.getElementById("botao-confirmar-acao");
  operando = true;
  botao.disabled = true;
  const rotulo = botao.textContent;
  botao.textContent = "Processando...";

  try {
    await confirmacaoPendente();
    fecharConfirmacao();
  } catch (erro) {
    console.error("Usuário:", erro);
    fecharConfirmacao();
    exibirMensagem(document.getElementById("alerta"), "erro", mensagemErroAdminUsuarios(erro));
  } finally {
    confirmacaoPendente = null;
    operando = false;
    botao.disabled = false;
    botao.textContent = rotulo;
  }
}

async function iniciar() {
  const aviso = document.getElementById("aviso-configuracao");

  try {
    contextoAtual = await protegerPaginaAdmin();
    if (!contextoAtual) {
      return;
    }

    preencherIdentidade(contextoAtual);
    atualizarNavegacao(contextoAtual.perfil);
    configurarMenuMobile();
    configurarSaida();
    configurarModulos();

    document.getElementById("botao-voltar").href = urlListagem();
    document.getElementById("botao-confirmar-acao").addEventListener("click", confirmarAcao);
    document.getElementById("botao-cancelar-confirmacao").addEventListener("click", () => {
      confirmacaoPendente = null;
      fecharConfirmacao();
    });

    limparMensagem(document.getElementById("alerta"));
    await recarregar();
  } catch (erro) {
    if (aviso) {
      aviso.hidden = false;
      aviso.textContent = erro.message;
    }
  }
}

iniciar();
