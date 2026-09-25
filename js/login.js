import { ROTAS } from "./config.js";
import { entrar, sair } from "./auth.js";
import { carregarPerfil, redirecionarSeAutenticado, redirecionarParaLogin } from "./guards.js";
import {
  configurarAlternanciaSenha,
  exibirMensagem,
  limparMensagem,
  mensagemErroAutenticacao,
  obterParametrosConsulta,
  validarEmail,
} from "./utils.js";

const mensagensIniciais = {
  inativo: "Seu usuário está inativo. Entre em contato com o administrador.",
  perfil: "Não foi possível carregar seu perfil. Entre em contato com o administrador.",
  senha: "Senha redefinida com sucesso. Entre com a nova senha.",
  saida: "Você saiu do sistema.",
};

function mensagemInicial() {
  const parametros = obterParametrosConsulta();
  const erro = parametros.get("erro");
  const mensagem = parametros.get("mensagem");

  if (erro && mensagensIniciais[erro]) {
    return { tipo: "erro", texto: mensagensIniciais[erro] };
  }

  if (mensagem && mensagensIniciais[mensagem]) {
    return { tipo: "sucesso", texto: mensagensIniciais[mensagem] };
  }

  return null;
}

async function iniciar() {
  const form = document.getElementById("form-login");
  const campoEmail = document.getElementById("email");
  const campoSenha = document.getElementById("senha");
  const botaoEntrar = document.getElementById("botao-entrar");
  const alerta = document.getElementById("alerta");
  const avisoConfig = document.getElementById("aviso-configuracao");

  configurarAlternanciaSenha(
    document.getElementById("alternar-senha"),
    campoSenha
  );

  const aviso = mensagemInicial();
  if (aviso) {
    exibirMensagem(alerta, aviso.tipo, aviso.texto);
  }

  try {
    const jaAutenticado = await redirecionarSeAutenticado();
    if (jaAutenticado) {
      return;
    }
  } catch (erro) {
    if (avisoConfig) {
      avisoConfig.hidden = false;
      avisoConfig.textContent = erro.message;
    }
    if (!aviso) {
      exibirMensagem(alerta, "erro", erro.message);
    }
  }

  form.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    limparMensagem(alerta);

    const email = campoEmail.value.trim();
    const senha = campoSenha.value;

    if (!email || !senha) {
      exibirMensagem(alerta, "erro", "Preencha e-mail e senha.");
      return;
    }

    if (!validarEmail(email)) {
      exibirMensagem(alerta, "erro", "Informe um e-mail válido.");
      return;
    }

    botaoEntrar.disabled = true;
    botaoEntrar.textContent = "Entrando...";

    try {
      const { user } = await entrar(email, senha);
      const perfil = await carregarPerfil(user.id);

      if (!perfil) {
        await sair();
        redirecionarParaLogin({ erro: "perfil" });
        return;
      }

      if (perfil.status !== "ATIVO") {
        await sair();
        redirecionarParaLogin({ erro: "inativo" });
        return;
      }

      window.location.assign(ROTAS.dashboard);
    } catch (erro) {
      exibirMensagem(alerta, "erro", mensagemErroAutenticacao(erro));
      botaoEntrar.disabled = false;
      botaoEntrar.textContent = "Entrar";
    }
  });
}

iniciar();
