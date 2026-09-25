import { SENHA_MINIMA, ROTAS } from "./config.js";
import { atualizarSenha, obterSessao, sair, observarAutenticacao } from "./auth.js";
import {
  configurarAlternanciaSenha,
  exibirMensagem,
  limparMensagem,
  mensagemErroAutenticacao,
} from "./utils.js";

let sessaoRecuperacaoPronta = false;

function senhaValida(senha, confirmacao, alerta) {
  if (!senha || !confirmacao) {
    exibirMensagem(alerta, "erro", "Preencha a nova senha e a confirmação.");
    return false;
  }

  if (senha.length < SENHA_MINIMA) {
    exibirMensagem(alerta, "erro", `A senha deve ter no mínimo ${SENHA_MINIMA} caracteres.`);
    return false;
  }

  if (senha !== confirmacao) {
    exibirMensagem(alerta, "erro", "A confirmação deve ser igual à nova senha.");
    return false;
  }

  return true;
}

async function iniciar() {
  const form = document.getElementById("form-redefinir");
  const campoSenha = document.getElementById("nova-senha");
  const campoConfirmacao = document.getElementById("confirmar-senha");
  const botao = document.getElementById("botao-salvar");
  const alerta = document.getElementById("alerta");

  configurarAlternanciaSenha(document.getElementById("alternar-nova-senha"), campoSenha);
  configurarAlternanciaSenha(document.getElementById("alternar-confirmacao"), campoConfirmacao);

  observarAutenticacao((evento, sessao) => {
    if (evento === "PASSWORD_RECOVERY" || (sessao && evento === "SIGNED_IN")) {
      sessaoRecuperacaoPronta = true;
      limparMensagem(alerta);
    }
  });

  try {
    const url = new URL(window.location.href);
    const temIndicadorRecuperacao =
      url.hash.includes("access_token") ||
      url.searchParams.has("code") ||
      url.hash.includes("type=recovery");

    if (!temIndicadorRecuperacao) {
      exibirMensagem(
        alerta,
        "erro",
        "Link de recuperação inválido ou expirado. Solicite um novo link."
      );
    }

    const limite = Date.now() + (temIndicadorRecuperacao ? 4000 : 0);

    while (Date.now() < limite) {
      const sessao = await obterSessao();
      if (sessao || sessaoRecuperacaoPronta) {
        sessaoRecuperacaoPronta = true;
        break;
      }
      await new Promise((resolver) => window.setTimeout(resolver, 200));
    }

    if (!sessaoRecuperacaoPronta) {
      exibirMensagem(
        alerta,
        "erro",
        "Link de recuperação inválido ou expirado. Solicite um novo link."
      );
    }
  } catch (erro) {
    exibirMensagem(alerta, "erro", erro.message);
  }

  form.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    limparMensagem(alerta);

    const senha = campoSenha.value;
    const confirmacao = campoConfirmacao.value;

    if (!senhaValida(senha, confirmacao, alerta)) {
      return;
    }

    if (!sessaoRecuperacaoPronta) {
      exibirMensagem(
        alerta,
        "erro",
        "Link de recuperação inválido ou expirado. Solicite um novo link."
      );
      return;
    }

    botao.disabled = true;
    botao.textContent = "Salvando...";

    try {
      await atualizarSenha(senha);
      await sair();
      window.location.assign(`${ROTAS.login}?mensagem=senha`);
    } catch (erro) {
      exibirMensagem(alerta, "erro", mensagemErroAutenticacao(erro));
      botao.disabled = false;
      botao.textContent = "Salvar nova senha";
    }
  });
}

iniciar();
