export function validarEmail(email) {
  const valor = String(email || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor);
}

export function obterParametrosConsulta() {
  return new URLSearchParams(window.location.search);
}

export function redirecionar(caminho) {
  window.location.replace(caminho);
}

export function definirTexto(elemento, texto) {
  if (elemento) {
    elemento.textContent = texto;
  }
}

export function exibirMensagem(container, tipo, texto) {
  if (!container) {
    return;
  }

  container.hidden = false;
  container.dataset.tipo = tipo;
  container.className = `alerta alerta--${tipo}`;
  container.textContent = texto;
}

export function limparMensagem(container) {
  if (!container) {
    return;
  }

  container.hidden = true;
  container.textContent = "";
  container.removeAttribute("data-tipo");
  container.className = "alerta";
}

export function mensagemErroAutenticacao(erro) {
  const codigo = String(erro?.code || "");
  const mensagem = String(erro?.message || "");

  if (codigo === "invalid_credentials" || mensagem.includes("Invalid login credentials")) {
    return "E-mail ou senha inválidos.";
  }

  if (mensagem.includes("Email not confirmed")) {
    return "E-mail ainda não confirmado. Verifique sua caixa de entrada.";
  }

  if (mensagem.includes("For security purposes")) {
    return "Aguarde alguns segundos antes de tentar novamente.";
  }

  return "Não foi possível concluir a operação. Tente novamente.";
}

export function formatarDataPorExtenso(data = new Date()) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(data);
}

export function formatarDataCivil(data) {
  const texto = String(data || "");
  const partes = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (!partes) {
    return "—";
  }

  return `${partes[3]}/${partes[2]}/${partes[1]}`;
}

export function formatarDataHora(data) {
  if (!data) {
    return "—";
  }

  const valor = data instanceof Date ? data : new Date(data);

  if (Number.isNaN(valor.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(valor);
}

export function formatarDataCurta(data) {
  if (!data) {
    return "—";
  }

  const texto = String(data);
  if (/^\d{4}-\d{2}-\d{2}/.test(texto) && !texto.includes("T") && !texto.includes(" ")) {
    return formatarDataCivil(texto);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    return formatarDataCivil(texto);
  }

  const valor = data instanceof Date ? data : new Date(data);

  if (Number.isNaN(valor.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("pt-BR").format(valor);
}

export function resumirTexto(texto, limite = 120) {
  const limpo = String(texto || "").replace(/\s+/g, " ").trim();

  if (!limpo) {
    return "Atividade sem descrição";
  }

  return limpo.length > limite ? `${limpo.slice(0, limite)}…` : limpo;
}

export function formatarQuantidadeFotos(quantidade) {
  const total = Number(quantidade) || 0;
  return total === 1 ? "1 foto" : `${total} fotos`;
}

export function formatarNomePerfil(perfil) {
  const mapa = {
    ADMIN: "Administrador",
    MOBILIZADOR: "Mobilizador",
  };

  return mapa[perfil] || perfil || "—";
}

export function dataHojeISO() {
  const agora = new Date();
  const ano = String(agora.getFullYear());
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  const dia = String(agora.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

export function contarCaracteres(texto) {
  return String(texto || "").trim().length;
}

export function configurarAlternanciaSenha(botao, campo) {
  if (!botao || !campo) {
    return;
  }

  botao.addEventListener("click", () => {
    const visivel = campo.type === "text";
    campo.type = visivel ? "password" : "text";
    botao.setAttribute("aria-pressed", String(!visivel));
    botao.textContent = visivel ? "Mostrar" : "Ocultar";
  });
}
