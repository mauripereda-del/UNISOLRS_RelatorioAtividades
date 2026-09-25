import {
  atualizarUsuarioAdmin,
  chamarAdminUsuarios,
  mensagemErroAdminUsuarios,
  normalizarEmailAdmin,
  normalizarNomeAdmin,
  normalizarTelefoneAdmin,
  obterContagensUsuarios,
  validarNomeAdmin,
  validarPerfilAdmin,
  validarStatusAdmin,
  validarTelefoneAdmin,
} from "./admin-usuarios.js";
import {
  ORDENACAO_USUARIOS,
  PERFIS,
  STATUS_USUARIO,
  USUARIOS,
  urlVisualizarUsuario,
} from "./config.js";
import { protegerPaginaAdmin } from "./guards.js";
import {
  atualizarNavegacao,
  configurarMenuMobile,
  configurarModulos,
  configurarSaida,
  preencherIdentidade,
} from "./layout.js";
import { obterClienteSupabase } from "./supabase.js";
import {
  exibirMensagem,
  formatarNomePerfil,
  limparMensagem,
  obterParametrosConsulta,
  validarEmail,
} from "./utils.js";

const ORDENACOES = new Set(Object.values(ORDENACAO_USUARIOS));

let contextoAtual = null;
let paginaAtual = 1;
let totalAtual = 0;
let operando = false;
let usuarioEdicao = null;
let confirmacaoPendente = null;
let origemFoco = null;

function filtrosPadrao() {
  return {
    busca: "",
    perfil: "",
    status: "",
    ordenacao: ORDENACAO_USUARIOS.nome,
    pagina: 1,
  };
}

function sanitizarFiltros(origem) {
  const filtros = filtrosPadrao();
  const params = origem instanceof URLSearchParams ? origem : new URLSearchParams(origem || "");
  const busca = String(params.get("busca") || "").trim().slice(0, USUARIOS.buscaMaxima);
  const perfil = String(params.get("perfil") || "").trim().toUpperCase();
  const status = String(params.get("status") || "").trim().toUpperCase();
  const ordenacao = String(params.get("ordenacao") || "").trim();
  const pagina = Number(params.get("pagina") || 1);

  filtros.busca = busca;
  if (validarPerfilAdmin(perfil)) {
    filtros.perfil = perfil;
  }
  if (validarStatusAdmin(status)) {
    filtros.status = status;
  }
  filtros.ordenacao = ORDENACOES.has(ordenacao) ? ordenacao : ORDENACAO_USUARIOS.nome;
  filtros.pagina = Number.isInteger(pagina) && pagina > 0 ? pagina : 1;
  return filtros;
}

function lerFiltros() {
  const params = new URLSearchParams();
  params.set("busca", document.getElementById("filtro-busca").value);
  params.set("perfil", document.getElementById("filtro-perfil").value);
  params.set("status", document.getElementById("filtro-status").value);
  params.set("ordenacao", document.getElementById("filtro-ordenacao").value);
  params.set("pagina", String(paginaAtual));
  return sanitizarFiltros(params);
}

function preencherFiltros(filtros) {
  document.getElementById("filtro-busca").value = filtros.busca;
  document.getElementById("filtro-perfil").value = filtros.perfil;
  document.getElementById("filtro-status").value = filtros.status;
  document.getElementById("filtro-ordenacao").value = filtros.ordenacao;
}

function sincronizarUrl(filtros) {
  const params = new URLSearchParams();
  if (filtros.busca) params.set("busca", filtros.busca);
  if (filtros.perfil) params.set("perfil", filtros.perfil);
  if (filtros.status) params.set("status", filtros.status);
  if (filtros.ordenacao !== ORDENACAO_USUARIOS.nome) params.set("ordenacao", filtros.ordenacao);
  if (filtros.pagina > 1) params.set("pagina", String(filtros.pagina));
  const consulta = params.toString();
  window.history.replaceState({}, "", consulta ? `${window.location.pathname}?${consulta}` : window.location.pathname);
}

function criarBadge(texto, classe) {
  const badge = document.createElement("span");
  badge.className = `status ${classe}`;
  badge.textContent = texto;
  return badge;
}

function badgePerfil(perfil) {
  return criarBadge(
    formatarNomePerfil(perfil),
    perfil === PERFIS.ADMIN ? "status--admin" : "status--mobilizador"
  );
}

function badgeStatus(status) {
  return criarBadge(
    status === STATUS_USUARIO.ATIVO ? "Ativo" : "Inativo",
    status === STATUS_USUARIO.ATIVO ? "status--ativo" : "status--inativo"
  );
}

function criarAcoes(usuario) {
  const grupo = document.createElement("div");
  grupo.className = "acoes-usuario";

  const visualizar = document.createElement("a");
  visualizar.className = "botao botao--texto";
  visualizar.href = urlVisualizarUsuario(usuario.id, window.location.search.replace(/^\?/, ""));
  visualizar.textContent = "Visualizar";
  grupo.append(visualizar);

  const editar = document.createElement("button");
  editar.className = "botao botao--texto";
  editar.type = "button";
  editar.textContent = "Editar";
  editar.addEventListener("click", () => abrirEdicao(usuario, editar));
  grupo.append(editar);

  const proprio = usuario.id === contextoAtual.usuario.id;
  if (!proprio) {
    const status = document.createElement("button");
    status.className = usuario.status === STATUS_USUARIO.ATIVO ? "botao botao--texto" : "botao botao--texto";
    status.type = "button";
    status.textContent = usuario.status === STATUS_USUARIO.ATIVO ? "Inativar" : "Ativar";
    status.addEventListener("click", () => pedirStatus(usuario, status));
    grupo.append(status);
  }

  const senha = document.createElement("button");
  senha.className = "botao botao--texto";
  senha.type = "button";
  senha.textContent = "Redefinir senha";
  senha.addEventListener("click", () => pedirSenha(usuario, senha));
  grupo.append(senha);

  return grupo;
}

function renderizar(registros, contagens, filtros) {
  const corpo = document.getElementById("corpo-usuarios");
  const cards = document.getElementById("cards-usuarios");
  const tabela = document.getElementById("tabela-usuarios-envoltorio");
  const vazio = document.getElementById("usuarios-vazio");
  const paginacao = document.getElementById("paginacao");
  const resumo = document.getElementById("resumo-pagina");

  corpo.replaceChildren();
  cards.replaceChildren();

  const inicio = totalAtual === 0 ? 0 : (filtros.pagina - 1) * USUARIOS.porPagina + 1;
  const fim = Math.min(filtros.pagina * USUARIOS.porPagina, totalAtual);
  resumo.textContent = totalAtual ? `Exibindo ${inicio}–${fim} de ${totalAtual} usuários` : "Nenhum usuário";

  if (!registros.length) {
    tabela.hidden = true;
    cards.hidden = true;
    vazio.hidden = false;
    paginacao.hidden = true;
    return;
  }

  vazio.hidden = true;
  tabela.hidden = false;
  cards.hidden = false;
  paginacao.hidden = totalAtual <= USUARIOS.porPagina;
  document.getElementById("pagina-anterior").disabled = filtros.pagina <= 1;
  document.getElementById("pagina-proxima").disabled = fim >= totalAtual;

  registros.forEach((usuario) => {
    const total = contagens[usuario.id]?.total ?? 0;
    const linha = document.createElement("tr");

    const tdNome = document.createElement("td");
    tdNome.className = "tabela-usuarios__nome";
    const nome = document.createElement("strong");
    nome.textContent = usuario.nome || "—";
    tdNome.append(nome);
    if (usuario.telefone) {
      const telefone = document.createElement("span");
      telefone.className = "tabela-usuarios__secundario";
      telefone.textContent = usuario.telefone;
      tdNome.append(telefone);
    }
    linha.append(tdNome);

    const tdEmail = document.createElement("td");
    tdEmail.className = "tabela-usuarios__email";
    tdEmail.textContent = usuario.email || "—";
    linha.append(tdEmail);

    const tdPerfil = document.createElement("td");
    tdPerfil.append(badgePerfil(usuario.perfil));
    linha.append(tdPerfil);

    const tdStatus = document.createElement("td");
    tdStatus.append(badgeStatus(usuario.status));
    linha.append(tdStatus);

    const tdAtividades = document.createElement("td");
    tdAtividades.className = "tabela-usuarios__atividades";
    tdAtividades.textContent = String(total);
    linha.append(tdAtividades);

    const acao = document.createElement("td");
    acao.className = "tabela-usuarios__acoes";
    acao.append(criarAcoes(usuario));
    linha.append(acao);
    corpo.append(linha);

    const cartao = document.createElement("article");
    cartao.className = "cartao-historico cartao-usuario";
    const topo = document.createElement("div");
    topo.className = "cartao-historico__topo";
    const forte = document.createElement("strong");
    forte.textContent = usuario.nome || "—";
    topo.append(forte, badgeStatus(usuario.status));
    const email = document.createElement("p");
    email.className = "cartao-usuario__email";
    email.textContent = usuario.email || "—";
    const meta = document.createElement("p");
    meta.className = "cartao-historico__meta";
    const partesMeta = [formatarNomePerfil(usuario.perfil)];
    if (usuario.telefone) {
      partesMeta.push(usuario.telefone);
    }
    partesMeta.push(`${total} ${total === 1 ? "atividade" : "atividades"}`);
    meta.textContent = partesMeta.join(" · ");
    cartao.append(topo, email, meta, criarAcoes(usuario));
    cards.append(cartao);
  });
}

async function consultar() {
  const alerta = document.getElementById("alerta");
  const filtros = lerFiltros();
  filtros.pagina = paginaAtual;
  sincronizarUrl(filtros);
  document.getElementById("carregando-usuarios").hidden = false;

  try {
    const supabase = obterClienteSupabase();
    const termo = filtros.busca.replace(/[%_,.()\\'"]/g, "").trim();
    let query = supabase
      .from("profiles")
      .select("id, nome, email, telefone, perfil, status, created_at, updated_at", { count: "exact" });

    if (termo) {
      query = query.or(`nome.ilike.%${termo}%,email.ilike.%${termo}%`);
    }
    if (filtros.perfil) {
      query = query.eq("perfil", filtros.perfil);
    }
    if (filtros.status) {
      query = query.eq("status", filtros.status);
    }

    if (filtros.ordenacao === ORDENACAO_USUARIOS.nomeDesc) {
      query = query.order("nome", { ascending: false });
    } else if (filtros.ordenacao === ORDENACAO_USUARIOS.recentes) {
      query = query.order("created_at", { ascending: false });
    } else if (filtros.ordenacao === ORDENACAO_USUARIOS.atualizados) {
      query = query.order("updated_at", { ascending: false });
    } else {
      query = query.order("nome", { ascending: true });
    }

    const inicio = (filtros.pagina - 1) * USUARIOS.porPagina;
    const { data, error, count } = await query.range(inicio, inicio + USUARIOS.porPagina - 1);
    if (error) {
      throw error;
    }

    const registros = data || [];
    totalAtual = count || 0;
    const ultimaPagina = Math.max(1, Math.ceil(totalAtual / USUARIOS.porPagina) || 1);
    if (totalAtual > 0 && filtros.pagina > ultimaPagina) {
      paginaAtual = ultimaPagina;
      await consultar();
      return;
    }
    const contagens = await obterContagensUsuarios(registros.map((item) => item.id));
    renderizar(registros, contagens, filtros);
    limparMensagem(alerta);
  } catch (erro) {
    console.error("Usuários:", erro);
    exibirMensagem(alerta, "erro", "Não foi possível carregar os usuários. Tente novamente.");
  } finally {
    document.getElementById("carregando-usuarios").hidden = true;
  }
}

function abrirDialogo(dialogo, foco) {
  origemFoco = foco || document.activeElement;
  dialogo.showModal();
  const inicial = dialogo.querySelector("input:not([type='hidden']), select, button");
  inicial?.focus();
}

function fecharDialogo(dialogo) {
  dialogo.close();
  origemFoco?.focus?.();
  origemFoco = null;
}

function limparFormularioUsuario() {
  document.getElementById("usuario-id").value = "";
  document.getElementById("usuario-updated-at").value = "";
  document.getElementById("usuario-nome").value = "";
  document.getElementById("usuario-email").value = "";
  document.getElementById("usuario-telefone").value = "";
  document.getElementById("usuario-perfil").value = PERFIS.MOBILIZADOR;
  document.getElementById("usuario-status").value = STATUS_USUARIO.ATIVO;
  document.getElementById("usuario-email").readOnly = false;
  document.getElementById("usuario-perfil").disabled = false;
  document.getElementById("usuario-status").disabled = false;
}

function abrirNovo(origem) {
  usuarioEdicao = null;
  limparFormularioUsuario();
  document.getElementById("titulo-dialogo-usuario").textContent = "Novo usuário";
  document.getElementById("texto-dialogo-usuario").textContent =
    "O usuário receberá instruções para definir a própria senha. A senha não é escolhida pelo administrador.";
  document.getElementById("botao-salvar-usuario").textContent = "Criar usuário";
  abrirDialogo(document.getElementById("dialogo-usuario"), origem);
}

function abrirEdicao(usuario, origem) {
  usuarioEdicao = usuario;
  document.getElementById("titulo-dialogo-usuario").textContent = "Editar usuário";
  document.getElementById("texto-dialogo-usuario").textContent =
    "Altere os dados cadastrais. A senha continua sendo definida pelo próprio usuário.";
  document.getElementById("usuario-id").value = usuario.id;
  document.getElementById("usuario-updated-at").value = usuario.updated_at || "";
  document.getElementById("usuario-nome").value = usuario.nome || "";
  document.getElementById("usuario-email").value = usuario.email || "";
  document.getElementById("usuario-telefone").value = usuario.telefone || "";
  document.getElementById("usuario-perfil").value = usuario.perfil;
  document.getElementById("usuario-status").value = usuario.status;
  const proprio = usuario.id === contextoAtual.usuario.id;
  document.getElementById("usuario-perfil").disabled = proprio;
  document.getElementById("usuario-status").disabled = proprio;
  document.getElementById("botao-salvar-usuario").textContent = "Salvar alterações";
  abrirDialogo(document.getElementById("dialogo-usuario"), origem);
}

function lerFormularioUsuario() {
  return {
    id: document.getElementById("usuario-id").value,
    updated_at: document.getElementById("usuario-updated-at").value,
    nome: normalizarNomeAdmin(document.getElementById("usuario-nome").value),
    email: normalizarEmailAdmin(document.getElementById("usuario-email").value),
    telefone: normalizarTelefoneAdmin(document.getElementById("usuario-telefone").value),
    perfil: document.getElementById("usuario-perfil").value,
    status: document.getElementById("usuario-status").value,
  };
}

function pedirConfirmacao({ titulo, texto, perigo = true, onConfirmar }) {
  confirmacaoPendente = onConfirmar;
  document.getElementById("titulo-confirmacao").textContent = titulo;
  document.getElementById("texto-confirmacao").textContent = texto;
  const botao = document.getElementById("botao-confirmar-acao");
  botao.className = perigo ? "botao botao--perigo" : "botao botao--primario";
  abrirDialogo(document.getElementById("dialogo-confirmacao"));
}

function pedirStatus(usuario, origem) {
  origemFoco = origem;
  const ativar = usuario.status !== STATUS_USUARIO.ATIVO;
  pedirConfirmacao({
    titulo: ativar ? "Ativar usuário" : "Inativar usuário",
    texto: ativar
      ? `Deseja ativar o acesso de ${usuario.nome} ao sistema?`
      : "O usuário perderá o acesso ao sistema, mas seu histórico será preservado. Deseja continuar?",
    perigo: !ativar,
    onConfirmar: async () => {
      await atualizarUsuarioAdmin({
        id: usuario.id,
        nome: usuario.nome,
        telefone: usuario.telefone,
        perfil: usuario.perfil,
        status: ativar ? STATUS_USUARIO.ATIVO : STATUS_USUARIO.INATIVO,
        updated_at: usuario.updated_at,
      });
      exibirMensagem(
        document.getElementById("alerta"),
        "sucesso",
        ativar ? "Usuário ativado com sucesso." : "Usuário inativado. O histórico foi preservado."
      );
      await consultar();
    },
  });
}

function pedirSenha(usuario, origem) {
  origemFoco = origem;
  pedirConfirmacao({
    titulo: "Enviar redefinição de senha",
    texto: `Enviar instruções de redefinição de senha para ${usuario.email}?`,
    perigo: false,
    onConfirmar: async () => {
      const resposta = await chamarAdminUsuarios("ENVIAR_RECUPERACAO", { id: usuario.id });
      exibirMensagem(
        document.getElementById("alerta"),
        "sucesso",
        resposta?.mensagem || "As instruções para definição da senha foram enviadas para o e-mail informado."
      );
    },
  });
}

async function salvarUsuario(evento) {
  evento.preventDefault();
  if (operando) {
    return;
  }

  const alerta = document.getElementById("alerta");
  const dados = lerFormularioUsuario();
  const botao = document.getElementById("botao-salvar-usuario");

  if (!validarNomeAdmin(dados.nome)) {
    exibirMensagem(alerta, "erro", "Informe um nome completo com pelo menos 3 caracteres.");
    return;
  }

  if (!validarEmail(dados.email)) {
    exibirMensagem(alerta, "erro", "Informe um e-mail válido.");
    return;
  }

  if (!validarTelefoneAdmin(dados.telefone)) {
    exibirMensagem(alerta, "erro", "Informe um telefone válido ou deixe o campo vazio.");
    return;
  }

  const criar = !dados.id;
  const promoverAdmin = dados.perfil === PERFIS.ADMIN && (criar || usuarioEdicao?.perfil !== PERFIS.ADMIN);
  const rebaixar = !criar && usuarioEdicao?.perfil === PERFIS.ADMIN && dados.perfil === PERFIS.MOBILIZADOR;

  const concluir = async () => {
    operando = true;
    botao.disabled = true;
    botao.textContent = criar ? "Criando usuário..." : "Salvando alterações...";

    try {
      if (criar) {
        const resposta = await chamarAdminUsuarios("CRIAR_USUARIO", dados);
        fecharDialogo(document.getElementById("dialogo-usuario"));
        exibirMensagem(alerta, "sucesso", resposta?.mensagem || "Usuário criado com sucesso.");
      } else {
        if (dados.email !== normalizarEmailAdmin(usuarioEdicao?.email)) {
          await chamarAdminUsuarios("ALTERAR_EMAIL", {
            id: dados.id,
            email: dados.email,
            updated_at: dados.updated_at,
          });
          const atualizado = await obterClienteSupabase()
            .from("profiles")
            .select("updated_at")
            .eq("id", dados.id)
            .maybeSingle();
          dados.updated_at = atualizado.data?.updated_at || dados.updated_at;
        }

        await atualizarUsuarioAdmin(dados);
        fecharDialogo(document.getElementById("dialogo-usuario"));
        exibirMensagem(alerta, "sucesso", "Alterações salvas com sucesso.");
      }

      await consultar();
    } catch (erro) {
      console.error("Usuários:", erro);
      exibirMensagem(alerta, "erro", mensagemErroAdminUsuarios(erro));
    } finally {
      operando = false;
      botao.disabled = false;
      botao.textContent = criar ? "Criar usuário" : "Salvar alterações";
    }
  };

  if (promoverAdmin) {
    pedirConfirmacao({
      titulo: "Confirmar administrador",
      texto: criar
        ? "Este usuário terá acesso administrativo, incluindo gerenciamento de usuários e atividades. Confirma a criação como Administrador?"
        : "Este usuário passará a possuir acesso administrativo ao sistema. Deseja continuar?",
      perigo: true,
      onConfirmar: concluir,
    });
    return;
  }

  if (rebaixar) {
    pedirConfirmacao({
      titulo: "Alterar perfil",
      texto: "Este administrador passará a ser mobilizador e perderá o acesso administrativo. Deseja continuar?",
      perigo: true,
      onConfirmar: concluir,
    });
    return;
  }

  await concluir();
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
    fecharDialogo(document.getElementById("dialogo-confirmacao"));
  } catch (erro) {
    console.error("Usuários:", erro);
    fecharDialogo(document.getElementById("dialogo-confirmacao"));
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

    const iniciais = sanitizarFiltros(obterParametrosConsulta());
    paginaAtual = iniciais.pagina;
    preencherFiltros(iniciais);

    document.getElementById("form-filtros").addEventListener("submit", (evento) => {
      evento.preventDefault();
      paginaAtual = 1;
      consultar();
    });
    document.getElementById("botao-limpar").addEventListener("click", () => {
      paginaAtual = 1;
      preencherFiltros(filtrosPadrao());
      consultar();
    });
    document.getElementById("pagina-anterior").addEventListener("click", () => {
      paginaAtual = Math.max(1, paginaAtual - 1);
      consultar();
    });
    document.getElementById("pagina-proxima").addEventListener("click", () => {
      paginaAtual += 1;
      consultar();
    });
    document.getElementById("botao-novo").addEventListener("click", (evento) => abrirNovo(evento.currentTarget));
    document.getElementById("form-usuario").addEventListener("submit", salvarUsuario);
    document.getElementById("botao-cancelar-usuario").addEventListener("click", () => {
      fecharDialogo(document.getElementById("dialogo-usuario"));
    });
    document.getElementById("botao-confirmar-acao").addEventListener("click", confirmarAcao);
    document.getElementById("botao-cancelar-confirmacao").addEventListener("click", () => {
      confirmacaoPendente = null;
      fecharDialogo(document.getElementById("dialogo-confirmacao"));
    });
    document.getElementById("dialogo-usuario").addEventListener("close", () => {
      origemFoco?.focus?.();
      origemFoco = null;
    });
    document.getElementById("dialogo-confirmacao").addEventListener("close", () => {
      origemFoco?.focus?.();
      origemFoco = null;
    });

    await consultar();
  } catch (erro) {
    if (aviso) {
      aviso.hidden = false;
      aviso.textContent = erro.message;
    }
  }
}

iniciar();
