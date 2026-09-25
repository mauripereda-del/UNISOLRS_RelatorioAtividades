import { atualizarMeuPerfil, mensagemErroAdminUsuarios, validarNomeAdmin, validarTelefoneAdmin } from "./admin-usuarios.js";
import { enviarRecuperacaoSenha } from "./auth.js";
import { protegerPagina } from "./guards.js";
import {
  atualizarNavegacao,
  configurarMenuMobile,
  configurarModulos,
  configurarSaida,
  preencherIdentidade,
} from "./layout.js";
import { exibirMensagem, formatarNomePerfil, limparMensagem } from "./utils.js";

let contextoAtual = null;
let operando = false;

function preencherFormulario(perfil) {
  document.getElementById("perfil-nome").value = perfil.nome || "";
  document.getElementById("perfil-email").value = perfil.email || "";
  document.getElementById("perfil-telefone").value = perfil.telefone || "";
  document.getElementById("perfil-perfil").value = formatarNomePerfil(perfil.perfil);
  document.getElementById("perfil-status").value = perfil.status === "ATIVO" ? "Ativo" : "Inativo";
}

async function salvar(evento) {
  evento.preventDefault();
  if (operando) {
    return;
  }

  const alerta = document.getElementById("alerta");
  const nome = document.getElementById("perfil-nome").value;
  const telefone = document.getElementById("perfil-telefone").value;
  const botao = document.getElementById("botao-salvar-perfil");

  if (!validarNomeAdmin(nome)) {
    exibirMensagem(alerta, "erro", "Informe um nome completo com pelo menos 3 caracteres.");
    return;
  }

  if (!validarTelefoneAdmin(telefone)) {
    exibirMensagem(alerta, "erro", "Informe um telefone válido ou deixe o campo vazio.");
    return;
  }

  operando = true;
  botao.disabled = true;
  botao.textContent = "Salvando alterações...";

  try {
    const atualizado = await atualizarMeuPerfil({
      id: contextoAtual.usuario.id,
      nome,
      telefone,
    });
    contextoAtual.perfil = { ...contextoAtual.perfil, ...atualizado };
    preencherIdentidade(contextoAtual);
    preencherFormulario(contextoAtual.perfil);
    exibirMensagem(alerta, "sucesso", "Perfil atualizado com sucesso.");
  } catch (erro) {
    console.error("Meu perfil:", erro);
    exibirMensagem(alerta, "erro", mensagemErroAdminUsuarios(erro));
  } finally {
    operando = false;
    botao.disabled = false;
    botao.textContent = "Salvar alterações";
  }
}

async function enviarSenha() {
  if (operando) {
    return;
  }

  const alerta = document.getElementById("alerta");
  const botao = document.getElementById("botao-confirmar-senha");
  operando = true;
  botao.disabled = true;
  botao.textContent = "Enviando redefinição...";

  try {
    await enviarRecuperacaoSenha(contextoAtual.perfil.email);
    document.getElementById("dialogo-confirmacao").close();
    exibirMensagem(
      alerta,
      "sucesso",
      "As instruções para definição da senha foram enviadas para o e-mail informado."
    );
  } catch (erro) {
    console.error("Meu perfil:", erro);
    document.getElementById("dialogo-confirmacao").close();
    exibirMensagem(alerta, "erro", "Não foi possível enviar a redefinição de senha. Tente novamente.");
  } finally {
    operando = false;
    botao.disabled = false;
    botao.textContent = "Enviar";
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
    preencherFormulario(contextoAtual.perfil);
    limparMensagem(document.getElementById("alerta"));

    document.getElementById("form-meu-perfil").addEventListener("submit", salvar);
    document.getElementById("botao-senha").addEventListener("click", () => {
      document.getElementById("texto-confirmacao").textContent =
        `Enviar instruções de redefinição de senha para ${contextoAtual.perfil.email}?`;
      document.getElementById("dialogo-confirmacao").showModal();
      document.getElementById("botao-confirmar-senha").focus();
    });
    document.getElementById("botao-confirmar-senha").addEventListener("click", enviarSenha);
    document.getElementById("botao-cancelar-senha").addEventListener("click", () => {
      document.getElementById("dialogo-confirmacao").close();
    });
  } catch (erro) {
    if (aviso) {
      aviso.hidden = false;
      aviso.textContent = erro.message;
    }
  }
}

iniciar();
