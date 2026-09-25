import { enviarRecuperacaoSenha } from "./auth.js";
import {
  exibirMensagem,
  limparMensagem,
  mensagemErroAutenticacao,
  validarEmail,
} from "./utils.js";

async function iniciar() {
  const form = document.getElementById("form-recuperar");
  const campoEmail = document.getElementById("email");
  const botao = document.getElementById("botao-enviar");
  const alerta = document.getElementById("alerta");

  form.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    limparMensagem(alerta);

    const email = campoEmail.value.trim();

    if (!email) {
      exibirMensagem(alerta, "erro", "Informe o e-mail da sua conta.");
      return;
    }

    if (!validarEmail(email)) {
      exibirMensagem(alerta, "erro", "Informe um e-mail válido.");
      return;
    }

    botao.disabled = true;
    botao.textContent = "Enviando...";

    try {
      await enviarRecuperacaoSenha(email);
      exibirMensagem(
        alerta,
        "sucesso",
        "Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha."
      );
      form.reset();
    } catch (erro) {
      exibirMensagem(alerta, "erro", mensagemErroAutenticacao(erro));
    } finally {
      botao.disabled = false;
      botao.textContent = "Enviar link de recuperação";
    }
  });
}

iniciar();
