import { MODULOS, ROTAS } from "./config.js";
import { sair } from "./auth.js";
import { ehAdministrador } from "./guards.js";
import { definirTexto, formatarNomePerfil, redirecionar } from "./utils.js";

export function fecharMenuMobile() {
  const menu = document.getElementById("menu-lateral");
  const botao = document.getElementById("botao-menu");
  const overlay = document.getElementById("menu-overlay");

  document.body.classList.remove("menu-aberto");
  menu?.classList.remove("is-aberto");
  overlay?.setAttribute("hidden", "");
  botao?.setAttribute("aria-expanded", "false");
}

function abrirMenuMobile() {
  const menu = document.getElementById("menu-lateral");
  const botao = document.getElementById("botao-menu");
  const overlay = document.getElementById("menu-overlay");

  document.body.classList.add("menu-aberto");
  menu?.classList.add("is-aberto");
  overlay?.removeAttribute("hidden");
  botao?.setAttribute("aria-expanded", "true");
}

export function configurarMenuMobile() {
  const botao = document.getElementById("botao-menu");
  const overlay = document.getElementById("menu-overlay");

  botao?.addEventListener("click", () => {
    if (document.body.classList.contains("menu-aberto")) {
      fecharMenuMobile();
    } else {
      abrirMenuMobile();
    }
  });

  overlay?.addEventListener("click", fecharMenuMobile);

  document.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape") {
      fecharMenuMobile();
      document.getElementById("dialogo-modulo")?.close();
    }
  });
}

export function configurarSaida({ confirmar } = {}) {
  document.querySelectorAll("[data-acao='sair']").forEach((botao) => {
    botao.addEventListener("click", async () => {
      if (confirmar && !confirmar()) {
        return;
      }

      try {
        await sair();
      } finally {
        redirecionar(`${ROTAS.login}?mensagem=saida`);
      }
    });
  });
}

export function abrirDialogoModulo(titulo) {
  const dialogo = document.getElementById("dialogo-modulo");
  const texto = document.getElementById("dialogo-modulo-texto");

  if (!dialogo || !texto) {
    return;
  }

  texto.textContent = `${titulo} estará disponível em uma próxima etapa.`;
  dialogo.showModal();
}

function ativarModulo(chave, { confirmar } = {}) {
  const modulo = MODULOS[chave];

  if (!modulo) {
    return;
  }

  if (confirmar && !confirmar()) {
    return;
  }

  if (modulo.disponivel) {
    window.location.assign(modulo.rota);
    return;
  }

  abrirDialogoModulo(modulo.titulo);
}

export function configurarModulos({ confirmar } = {}) {
  document.querySelectorAll("[data-modulo]").forEach((elemento) => {
    elemento.addEventListener("click", (evento) => {
      evento.preventDefault();
      fecharMenuMobile();
      ativarModulo(elemento.dataset.modulo, { confirmar });
    });
  });

  document.querySelectorAll("a[href$='dashboard.html']").forEach((link) => {
    link.addEventListener("click", (evento) => {
      if (confirmar && !confirmar()) {
        evento.preventDefault();
      }
    });
  });

  document.getElementById("dialogo-modulo-fechar")?.addEventListener("click", () => {
    document.getElementById("dialogo-modulo")?.close();
  });
}

export function atualizarNavegacao(perfil) {
  const itemUsuarios = document.getElementById("item-usuarios");
  const itemReaberturas = document.getElementById("item-reaberturas");
  const atalhoUsuarios = document.getElementById("atalho-usuarios");
  const atalhoReaberturas = document.getElementById("atalho-reaberturas");
  const admin = ehAdministrador(perfil);

  if (itemUsuarios) {
    itemUsuarios.hidden = !admin;
  }

  if (itemReaberturas) {
    itemReaberturas.hidden = !admin;
  }

  if (atalhoUsuarios) {
    atalhoUsuarios.hidden = !admin;
  }

  if (atalhoReaberturas) {
    atalhoReaberturas.hidden = !admin;
  }
}

export function preencherIdentidade({ usuario, perfil }) {
  const nome = perfil.nome || "usuário";
  const email = perfil.email || usuario.email || "—";
  const nomePerfil = formatarNomePerfil(perfil.perfil);

  document.querySelectorAll("[data-campo='nome']").forEach((el) => definirTexto(el, nome));
  document.querySelectorAll("[data-campo='email']").forEach((el) => definirTexto(el, email));
  document.querySelectorAll("[data-campo='perfil']").forEach((el) => definirTexto(el, nomePerfil));

  const selo = document.getElementById("selo-perfil");
  if (selo) {
    selo.textContent = nomePerfil;
    selo.dataset.perfil = perfil.perfil;
  }
}
