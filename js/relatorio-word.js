import { obterAtividadeDetalhada } from "./atividades.js";
import { gerarUrlVisualizacao, listarFotos } from "./atividade-fotos.js";
import { formatarDataCancelamento, obterInformacoesCancelamento } from "./cancelamento.js";
import {
  RELATORIO_WORD,
  ROTULO_STATUS_EXIBIDO,
  STATUS_ATIVIDADE,
  STATUS_EXIBIDO,
} from "./config.js";
import { obterStatusExibido } from "./reabertura.js";
import { formatarDataCivil } from "./utils.js";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  convertMillimetersToTwip,
} from "./vendor/docx.mjs";

const COR = {
  primaria: "1B4D6E",
  texto: "1A2332",
  suave: "5C6B7A",
  aviso: "B54708",
  avisoFundo: "FFFAEB",
  erro: "B42318",
  erroFundo: "FEF3F2",
  branco: "FFFFFF",
};

const MENSAGEM_FOTO =
  "Não foi possível carregar uma ou mais fotografias. O relatório não foi gerado. Tente novamente.";
const MENSAGEM_FOTO_MENSAL =
  "Não foi possível carregar uma ou mais fotografias. O relatório mensal não foi gerado. Tente novamente.";
const MENSAGEM_LOGO =
  "Não foi possível carregar o logotipo institucional. O relatório não foi gerado.";
const MENSAGEM_GENERICA = "Não foi possível gerar o relatório. Tente novamente.";
const MENSAGEM_MENSAL = "Não foi possível gerar o relatório mensal.";

export class ErroRelatorioWord extends Error {
  constructor(mensagem, { causa, codigo } = {}) {
    super(mensagem);
    this.name = "ErroRelatorioWord";
    this.causa = causa;
    this.codigo = codigo;
  }
}

export function mensagemErroRelatorioWord(erro) {
  if (erro instanceof ErroRelatorioWord && erro.message) {
    return erro.message;
  }

  const texto = String(erro?.message || "");
  if (texto.includes("período foram alterados") || texto.includes("Consulte novamente")) {
    return "Os dados do período foram alterados. Consulte novamente antes de gerar o relatório.";
  }

  if (texto.includes("não possui registro fotográfico")) {
    return texto;
  }

  if (texto.includes("fotograf") && texto.includes("mensal")) {
    return MENSAGEM_FOTO_MENSAL;
  }

  if (texto.includes("fotograf")) {
    return MENSAGEM_FOTO;
  }
  if (texto.includes("logotipo") || texto.includes("logo")) {
    return MENSAGEM_LOGO;
  }

  if (texto.includes("relatório mensal")) {
    return MENSAGEM_MENSAL;
  }

  return MENSAGEM_GENERICA;
}

function bordaNula() {
  const vazia = { style: BorderStyle.NONE, size: 0, color: COR.branco };
  return {
    top: vazia,
    bottom: vazia,
    left: vazia,
    right: vazia,
    insideHorizontal: vazia,
    insideVertical: vazia,
  };
}

function run(texto, extras = {}) {
  return new TextRun({
    text: String(texto ?? ""),
    font: RELATORIO_WORD.fonte,
    size: extras.size || RELATORIO_WORD.tamanhoCorpo,
    color: extras.color || COR.texto,
    bold: Boolean(extras.bold),
    italics: Boolean(extras.italics),
  });
}

export function calcularDimensoesImagem(
  larguraNatural,
  alturaNatural,
  { maxLargura = RELATORIO_WORD.maxLarguraFoto, maxAltura = RELATORIO_WORD.maxAlturaFoto } = {}
) {
  const largura = Number(larguraNatural) || maxLargura;
  const altura = Number(alturaNatural) || Math.round(maxLargura * 0.75);
  const escala = Math.min(maxLargura / largura, maxAltura / altura, 1);

  return {
    width: Math.max(1, Math.round(largura * escala)),
    height: Math.max(1, Math.round(altura * escala)),
  };
}

export function criarParagrafosTexto(texto, extras = {}) {
  const bruto = String(texto ?? "").replace(/\r\n/g, "\n");

  if (!bruto.trim()) {
    return [
      new Paragraph({
        spacing: { after: 160 },
        children: [run("—", { italics: true, color: COR.suave })],
      }),
    ];
  }

  return bruto.split(/\n{2,}/).map((bloco) => {
    const linhas = bloco.split("\n");
    const children = [];

    linhas.forEach((linha, indice) => {
      if (indice > 0) {
        children.push(new TextRun({ break: 1 }));
      }
      children.push(run(linha, extras));
    });

    return new Paragraph({
      spacing: { after: 160, line: 276 },
      children,
    });
  });
}

export function criarTituloSecao(texto) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 320, after: 140 },
    border: {
      bottom: { color: COR.primaria, space: 6, style: BorderStyle.SINGLE, size: 12 },
    },
    children: [run(texto, { bold: true, size: 26, color: COR.primaria })],
  });
}

export function criarCampo(rotulo, valor) {
  return new Paragraph({
    spacing: { after: 80 },
    children: [run(`${rotulo}: `, { bold: true }), run(valor || "—")],
  });
}

export function criarAviso(texto, { fundo, cor } = {}) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    shading: { type: ShadingType.CLEAR, fill: fundo || COR.avisoFundo },
    spacing: { before: 80, after: 160 },
    children: [run(texto, { bold: true, size: 24, color: cor || COR.aviso })],
  });
}

export function criarTitulo() {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 80 },
      children: [run("RELATÓRIO DE ATIVIDADE", { bold: true, size: 36, color: COR.primaria })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [run("UNISOL Rio Grande do Sul", { size: 24, color: COR.suave })],
    }),
  ];
}

export function criarIdentificacao({ mobilizador, dataAtividade, situacao }) {
  return [
    criarTituloSecao("IDENTIFICAÇÃO DA ATIVIDADE"),
    criarCampo("Mobilizador", mobilizador),
    criarCampo("Data da atividade", dataAtividade),
    criarCampo("Situação", situacao),
  ];
}

export function criarSecaoTexto(titulo, texto) {
  return [criarTituloSecao(titulo), ...criarParagrafosTexto(texto)];
}

export function criarQuebraPagina() {
  return new Paragraph({ children: [new PageBreak()] });
}

export function propriedadesPaginaA4() {
  return {
    size: {
      width: convertMillimetersToTwip(210),
      height: convertMillimetersToTwip(297),
    },
    margin: {
      top: convertMillimetersToTwip(20),
      bottom: convertMillimetersToTwip(20),
      left: convertMillimetersToTwip(25),
      right: convertMillimetersToTwip(20),
    },
  };
}

export function estilosDocumentoPadrao() {
  return {
    default: {
      document: {
        run: {
          font: RELATORIO_WORD.fonte,
          size: RELATORIO_WORD.tamanhoCorpo,
          color: COR.texto,
        },
      },
    },
  };
}

export async function mapearComLimite(itens, limite, iterar) {
  const lista = itens || [];
  if (!lista.length) {
    return [];
  }

  const saida = new Array(lista.length);
  let proximo = 0;
  const simultaneos = Math.max(1, Math.min(limite || 4, lista.length));

  await Promise.all(
    Array.from({ length: simultaneos }, async () => {
      while (proximo < lista.length) {
        const atual = proximo;
        proximo += 1;
        saida[atual] = await iterar(lista[atual], atual);
      }
    })
  );

  return saida;
}

export function criarRegistroFotografico(
  fotosPreparadas,
  { titulo = "3. REGISTRO FOTOGRÁFICO", mensagemVazio = "Nenhuma fotografia registrada até o momento." } = {}
) {
  const blocos = [criarTituloSecao(titulo)];

  if (!fotosPreparadas?.length) {
    blocos.push(
      new Paragraph({
        spacing: { after: 160 },
        children: [run(mensagemVazio, { italics: true })],
      })
    );
    return blocos;
  }

  fotosPreparadas.forEach((foto, indice) => {
    const numero = indice + 1;
    const legenda = String(foto.legenda || "").trim();
    const rotulo = legenda ? `Foto ${numero} — ${legenda}` : `Foto ${numero}`;

    blocos.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        keepNext: true,
        spacing: { before: 160, after: 80 },
        children: [
          new ImageRun({
            type: foto.type,
            data: foto.data,
            transformation: { width: foto.width, height: foto.height },
            altText: {
              title: rotulo,
              description: rotulo,
              name: rotulo,
            },
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        keepLines: true,
        spacing: { after: 240 },
        children: [run(rotulo, { italics: true, size: 18, color: COR.suave })],
      })
    );
  });

  return blocos;
}

export function criarInformacoesRegistro({ responsavel, registradoEm, atualizadoEm }) {
  return [
    criarTituloSecao("INFORMAÇÕES DO REGISTRO"),
    criarCampo("Responsável", responsavel),
    criarCampo("Registrado em", registradoEm),
    criarCampo("Última atualização", atualizadoEm),
  ];
}

export function criarInformacoesCancelamento({ canceladaEm, canceladaPor, motivo }) {
  return [
    criarTituloSecao("INFORMAÇÕES DO CANCELAMENTO"),
    criarCampo("Cancelada em", canceladaEm),
    criarCampo("Cancelada por", canceladaPor),
    criarCampo("Motivo", motivo),
  ];
}

export function criarCabecalhoDiscreto(texto) {
  return new Header({
    children: [
      new Paragraph({
        border: {
          bottom: { color: "D5DDE5", space: 8, style: BorderStyle.SINGLE, size: 6 },
        },
        spacing: { after: 80 },
        children: [run(texto, { bold: true, size: 18, color: COR.suave })],
      }),
    ],
  });
}

export function criarCabecalho(logo, { subtitulo = "Relatório de Atividades" } = {}) {
  const dimensoes = calcularDimensoesImagem(logo.width, logo.height, {
    maxLargura: 72,
    maxAltura: 48,
  });

  return new Header({
    children: [
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: bordaNula(),
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 18, type: WidthType.PERCENTAGE },
                borders: bordaNula(),
                verticalAlign: VerticalAlign.CENTER,
                children: [
                  new Paragraph({
                    children: [
                      new ImageRun({
                        type: logo.type,
                        data: logo.data,
                        transformation: dimensoes,
                        altText: {
                          title: "UNISOL RS",
                          description: "Logotipo UNISOL RS",
                          name: "UNISOL RS",
                        },
                      }),
                    ],
                  }),
                ],
              }),
              new TableCell({
                borders: bordaNula(),
                verticalAlign: VerticalAlign.CENTER,
                children: [
                  new Paragraph({ children: [run("UNISOL RS", { bold: true, size: 22, color: COR.primaria })] }),
                  new Paragraph({
                    children: [run(subtitulo, { size: 18, color: COR.suave })],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

export function criarRodape({ texto = "UNISOL RS — Relatório de Atividades" } = {}) {
  return new Footer({
    children: [
      new Paragraph({
        border: {
          top: { color: "D5DDE5", space: 8, style: BorderStyle.SINGLE, size: 6 },
        },
        spacing: { before: 80 },
        children: [
          run(texto, { size: 16, color: COR.suave }),
          run("    ", { size: 16 }),
          run("Página ", { size: 16, color: COR.suave }),
          new TextRun({
            children: [PageNumber.CURRENT],
            font: RELATORIO_WORD.fonte,
            size: 16,
            color: COR.suave,
          }),
        ],
      }),
    ],
  });
}

function sanitizarTrechoNome(texto) {
  const limpo = String(texto || "Mobilizador")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);

  return limpo || "Mobilizador";
}

export function nomeArquivoRelatorio(atividade, responsavel) {
  const data = String(atividade?.data_atividade || "").slice(0, 10) || "data";
  const criacao = atividade?.created_at ? new Date(atividade.created_at) : new Date();
  const hora = Number.isNaN(criacao.getTime())
    ? "0000"
    : `${String(criacao.getHours()).padStart(2, "0")}${String(criacao.getMinutes()).padStart(2, "0")}`;

  return `Relatorio_Atividade_${data}_${sanitizarTrechoNome(responsavel)}_${hora}.docx`;
}

export function baixarBlob(blob, nomeArquivo) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeArquivo;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function decodificarImagem(blob) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob, { imageOrientation: "from-image" });
    } catch (_erro) {
      // Alguns navegadores não aceitam imageOrientation.
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const imagem = new Image();
      imagem.onload = () => resolve(imagem);
      imagem.onerror = () => reject(new Error("decode"));
      imagem.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function tipoDocx(mime) {
  return mime === "image/png" ? "png" : "jpg";
}

export async function carregarImagem(url, { mimePreferido = "image/png", reamostrar = false } = {}) {
  const resposta = await fetch(url, { cache: "no-store" });
  if (!resposta.ok) {
    throw new Error("fetch");
  }

  const blob = await resposta.blob();
  const mimeResposta = String(blob.type || mimePreferido).toLowerCase();
  const mime = mimeResposta.includes("png") ? "image/png" : "image/jpeg";
  const bitmap = await decodificarImagem(blob);

  try {
    if (!reamostrar) {
      const data = await blob.arrayBuffer();
      return {
        data,
        type: tipoDocx(mime),
        width: bitmap.width,
        height: bitmap.height,
      };
    }

    const limite = 1600;
    const escala = Math.min(1, limite / bitmap.width, limite / bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * escala));
    canvas.height = Math.max(1, Math.round(bitmap.height * escala));
    const contexto = canvas.getContext("2d");
    contexto.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const gerado = await new Promise((resolve, reject) => {
      canvas.toBlob((saida) => (saida ? resolve(saida) : reject(new Error("canvas"))), mime, 0.9);
    });

    return {
      data: await gerado.arrayBuffer(),
      type: tipoDocx(mime),
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    if (typeof bitmap.close === "function") {
      bitmap.close();
    }
  }
}

export async function carregarLogoInstitucional() {
  try {
    const logo = await carregarImagem(RELATORIO_WORD.logo, { mimePreferido: "image/png" });
    if (!logo?.data) {
      throw new Error("logo");
    }
    return logo;
  } catch (erro) {
    throw new ErroRelatorioWord(MENSAGEM_LOGO, { causa: erro, codigo: "logo" });
  }
}

export async function prepararFotografias(fotos) {
  const preparadas = [];

  for (const foto of fotos) {
    try {
      const url = await gerarUrlVisualizacao(foto.storage_path);
      if (!url) {
        throw new Error("signed-url");
      }

      const imagem = await carregarImagem(url, {
        mimePreferido: foto.mime_type || "image/jpeg",
        reamostrar: true,
      });
      const dimensoes = calcularDimensoesImagem(imagem.width, imagem.height);

      preparadas.push({
        ...dimensoes,
        data: imagem.data,
        type: imagem.type,
        legenda: foto.legenda || "",
      });
    } catch (erro) {
      throw new ErroRelatorioWord(MENSAGEM_FOTO, { causa: erro, codigo: "foto" });
    }
  }

  return preparadas;
}

function rotuloSituacao(statusExibido) {
  if (statusExibido === STATUS_EXIBIDO.REABERTURA_APROVADA) {
    return "Reabertura Aprovada — atividade em correção";
  }

  return ROTULO_STATUS_EXIBIDO[statusExibido] || statusExibido || "—";
}

function criarSituacaoAdministrativa(statusExibido, ultimaSolicitacao) {
  if (statusExibido === STATUS_EXIBIDO.REABERTURA_SOLICITADA) {
    return [
      criarTituloSecao("SITUAÇÃO ADMINISTRATIVA"),
      new Paragraph({
        spacing: { after: 160 },
        children: [run("Reabertura solicitada — aguardando análise.")],
      }),
    ];
  }

  if (statusExibido === STATUS_EXIBIDO.REABERTURA_RECUSADA) {
    const quando = ultimaSolicitacao?.analisado_em
      ? formatarDataCancelamento(ultimaSolicitacao.analisado_em)
      : "";
    return [
      criarTituloSecao("SITUAÇÃO ADMINISTRATIVA"),
      new Paragraph({
        spacing: { after: 160 },
        children: [
          run(
            quando
              ? `Última solicitação de reabertura recusada em ${quando}.`
              : "Última solicitação de reabertura recusada."
          ),
        ],
      }),
    ];
  }

  return [];
}

function criarAvisosStatus(atividade, statusExibido) {
  const avisos = [];

  if (atividade.status === STATUS_ATIVIDADE.CANCELADA) {
    avisos.push(criarAviso("ATIVIDADE CANCELADA", { fundo: COR.erroFundo, cor: COR.erro }));
  }

  if (
    atividade.status === STATUS_ATIVIDADE.RASCUNHO ||
    statusExibido === STATUS_EXIBIDO.REABERTURA_APROVADA
  ) {
    avisos.push(criarAviso("RASCUNHO — DOCUMENTO NÃO FINALIZADO"));
  }

  return avisos;
}

export async function montarDocumentoAtividade({
  atividade,
  statusExibido,
  ultimaSolicitacao,
  cancelamento,
  fotos,
  logo,
}) {
  const responsavel = atividade.responsavel || "—";
  const corpo = [
    ...criarTitulo(),
    ...criarAvisosStatus(atividade, statusExibido),
    ...criarIdentificacao({
      mobilizador: responsavel,
      dataAtividade: formatarDataCivil(atividade.data_atividade),
      situacao: rotuloSituacao(statusExibido),
    }),
    ...criarSecaoTexto("1. INTRODUÇÃO", atividade.introducao),
    ...criarSecaoTexto("2. ATIVIDADE REALIZADA", atividade.descricao),
    ...criarRegistroFotografico(fotos),
    ...criarSecaoTexto("4. CONCLUSÃO / ENCAMINHAMENTOS", atividade.conclusao),
    ...criarInformacoesRegistro({
      responsavel,
      registradoEm: formatarDataCancelamento(atividade.created_at),
      atualizadoEm: formatarDataCancelamento(atividade.updated_at),
    }),
  ];

  if (atividade.status === STATUS_ATIVIDADE.CANCELADA && cancelamento) {
    corpo.push(
      ...criarInformacoesCancelamento({
        canceladaEm: cancelamento.dataHora || formatarDataCancelamento(cancelamento.canceladaEm),
        canceladaPor: cancelamento.canceladaPorNome || "Administrador",
        motivo: cancelamento.motivo || atividade.motivo_cancelamento || "—",
      })
    );
  }

  corpo.push(...criarSituacaoAdministrativa(statusExibido, ultimaSolicitacao));

  return new Document({
    creator: "UNISOL RS",
    title: "Relatório de Atividade",
    description: "Relatório individual de atividade da UNISOL RS",
    styles: estilosDocumentoPadrao(),
    sections: [
      {
        properties: {
          page: propriedadesPaginaA4(),
        },
        headers: { default: criarCabecalho(logo) },
        footers: { default: criarRodape() },
        children: corpo,
      },
    ],
  });
}

export async function gerarRelatorioWord(atividadeOrigem, { ultimaSolicitacao = null } = {}) {
  if (!atividadeOrigem?.id) {
    throw new ErroRelatorioWord(MENSAGEM_GENERICA);
  }

  const atividade = await obterAtividadeDetalhada(atividadeOrigem.id);
  if (!atividade) {
    throw new ErroRelatorioWord("Atividade não encontrada ou você não possui acesso a ela.");
  }

  const [logo, fotosBrutas, cancelamento] = await Promise.all([
    carregarLogoInstitucional(),
    listarFotos(atividade.id),
    atividade.status === STATUS_ATIVIDADE.CANCELADA
      ? obterInformacoesCancelamento(atividade.id).catch(() => ({
          canceladaPorNome: "Administrador",
          dataHora: formatarDataCancelamento(atividade.cancelada_em),
          motivo: atividade.motivo_cancelamento || "",
        }))
      : Promise.resolve(null),
  ]);

  const fotos = await prepararFotografias(fotosBrutas);
  const statusExibido = obterStatusExibido(atividade, ultimaSolicitacao);
  const documento = await montarDocumentoAtividade({
    atividade,
    statusExibido,
    ultimaSolicitacao,
    cancelamento,
    fotos,
    logo,
  });

  const blob = await Packer.toBlob(documento);
  baixarBlob(blob, nomeArquivoRelatorio(atividade, atividade.responsavel));
  return blob;
}

export function nomeArquivoRelatorioMensal(ano, mes, responsavel) {
  const anoTxt = String(ano).padStart(4, "0");
  const mesTxt = String(mes).padStart(2, "0");
  return `Relatorio_Mensal_${anoTxt}_${mesTxt}_${sanitizarTrechoNome(responsavel)}.docx`;
}

export function criarCapaMensal({ logo, mobilizador, periodo, quantidade, ano }) {
  const dimensoes = calcularDimensoesImagem(logo.width, logo.height, {
    maxLargura: 160,
    maxAltura: 120,
  });

  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 400, after: 280 },
      children: [
        new ImageRun({
          type: logo.type,
          data: logo.data,
          transformation: dimensoes,
          altText: {
            title: "UNISOL RS",
            description: "Logotipo UNISOL RS",
            name: "UNISOL RS",
          },
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [run("UNISOL RS", { bold: true, size: 36, color: COR.primaria })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [run("RELATÓRIO MENSAL DE ATIVIDADES", { bold: true, size: 32, color: COR.primaria })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [run("Mobilizador:", { bold: true, size: 24 }), run(` ${mobilizador}`, { size: 24 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [run("Período:", { bold: true, size: 24 }), run(` ${periodo}`, { size: 24 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 600 },
      children: [
        run("Quantidade de atividades:", { bold: true, size: 24 }),
        run(` ${quantidade}`, { size: 24 }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 1600, after: 60 },
      children: [run("Rio Grande do Sul", { size: 22, color: COR.suave })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [run(String(ano), { size: 22, color: COR.suave })],
    }),
  ];
}

function criarTabelaResumoMensal(linhas) {
  const borda = { style: BorderStyle.SINGLE, size: 4, color: "D5DDE5" };
  const bordas = {
    top: borda,
    bottom: borda,
    left: borda,
    right: borda,
    insideHorizontal: borda,
    insideVertical: borda,
  };

  const celula = (texto, { cabecalho = false, largura } = {}) =>
    new TableCell({
      width: { size: largura, type: WidthType.PERCENTAGE },
      borders: bordas,
      shading: cabecalho ? { type: ShadingType.CLEAR, fill: "E7EEF3" } : undefined,
      children: [
        new Paragraph({
          children: [run(texto, { bold: cabecalho, size: 20, color: cabecalho ? COR.primaria : COR.texto })],
        }),
      ],
    });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          celula("Nº", { cabecalho: true, largura: 10 }),
          celula("Data", { cabecalho: true, largura: 22 }),
          celula("Atividade", { cabecalho: true, largura: 68 }),
        ],
      }),
      ...linhas.map((linha) =>
        new TableRow({
          children: [
            celula(linha.numero, { largura: 10 }),
            celula(linha.data, { largura: 22 }),
            celula(linha.resumo, { largura: 68 }),
          ],
        })
      ),
    ],
  });
}

function situacaoAdministrativaMensal(statusExibido) {
  if (statusExibido === STATUS_EXIBIDO.REABERTURA_SOLICITADA) {
    return "Reabertura solicitada — aguardando análise.";
  }

  if (statusExibido === STATUS_EXIBIDO.REABERTURA_RECUSADA) {
    return "Solicitação de reabertura recusada.";
  }

  return "";
}

function criarBlocoAtividadeMensal(atividade, indice, fotos, { quebrarAntes }) {
  const numero = String(indice + 1).padStart(2, "0");
  const statusExibido = atividade.statusExibido || obterStatusExibido(atividade, atividade.ultimaSolicitacao);
  const administrativa = situacaoAdministrativaMensal(statusExibido);
  const blocos = [];

  if (quebrarAntes) {
    blocos.push(criarQuebraPagina());
  }

  blocos.push(
    new Paragraph({
      spacing: { before: 80, after: 120 },
      children: [run(`ATIVIDADE ${numero}`, { bold: true, size: 28, color: COR.primaria })],
    }),
    criarCampo("Data", formatarDataCivil(atividade.data_atividade)),
    criarCampo("Situação", "Concluída")
  );

  if (administrativa) {
    blocos.push(criarCampo("Situação administrativa", administrativa));
  }

  blocos.push(
    ...criarSecaoTexto("Introdução", atividade.introducao),
    ...criarSecaoTexto("Atividade Realizada", atividade.descricao),
    ...criarRegistroFotografico(fotos, {
      titulo: "Registro Fotográfico",
      mensagemVazio: "Registro fotográfico não disponível.",
    }),
    ...criarSecaoTexto("Conclusão / Encaminhamentos", atividade.conclusao)
  );

  return blocos;
}

export async function gerarRelatorioMensalWord({
  atividadesPreview,
  mobilizadorNome,
  periodoExtenso,
  mes,
  ano,
  onProgresso,
} = {}) {
  const avisar = (texto, percentual) => {
    if (typeof onProgresso === "function") {
      onProgresso({ texto, percentual });
    }
  };

  const previstas = atividadesPreview || [];
  if (!previstas.length) {
    throw new ErroRelatorioWord("Nenhuma atividade concluída foi encontrada para este mobilizador no período selecionado.");
  }

  avisar("Preparando relatório...", 5);
  const logo = await carregarLogoInstitucional();

  const idsPrevistos = previstas.map((item) => item.id).sort().join(",");
  const atividades = [];

  for (let indice = 0; indice < previstas.length; indice += 1) {
    const prevista = previstas[indice];
    avisar(`Carregando atividade ${indice + 1} de ${previstas.length}...`, 8 + Math.round((indice / previstas.length) * 70));

    const atual = await obterAtividadeDetalhada(prevista.id);
    if (!atual || atual.status !== STATUS_ATIVIDADE.CONCLUIDA) {
      throw new ErroRelatorioWord("Os dados do período foram alterados. Consulte novamente antes de gerar o relatório.");
    }

    const fotosBrutas = await listarFotos(atual.id);
    let fotos = [];

    if (fotosBrutas.length) {
      try {
        fotos = await mapearComLimite(fotosBrutas, 4, async (foto) => {
          const url = await gerarUrlVisualizacao(foto.storage_path);
          if (!url) {
            throw new Error("signed-url");
          }

          const imagem = await carregarImagem(url, {
            mimePreferido: foto.mime_type || "image/jpeg",
            reamostrar: true,
          });
          const dimensoes = calcularDimensoesImagem(imagem.width, imagem.height);
          return {
            ...dimensoes,
            data: imagem.data,
            type: imagem.type,
            legenda: foto.legenda || "",
          };
        });
      } catch (erro) {
        throw new ErroRelatorioWord(MENSAGEM_FOTO_MENSAL, { causa: erro, codigo: "foto" });
      }
    }

    atividades.push({
      ...atual,
      statusExibido: prevista.statusExibido,
      ultimaSolicitacao: prevista.ultimaSolicitacao,
      fotos,
    });
  }

  const idsAtuais = atividades.map((item) => item.id).sort().join(",");
  if (idsAtuais !== idsPrevistos) {
    throw new ErroRelatorioWord("Os dados do período foram alterados. Consulte novamente antes de gerar o relatório.");
  }

  avisar("Montando documento...", 88);

  const linhasResumo = atividades.map((item, indice) => ({
    numero: String(indice + 1).padStart(2, "0"),
    data: formatarDataCivil(item.data_atividade),
    resumo: resumirTextoRelatorio(item.descricao || item.introducao),
  }));

  const corpo = [
    ...criarCapaMensal({
      logo,
      mobilizador: mobilizadorNome,
      periodo: periodoExtenso,
      quantidade: atividades.length,
      ano,
    }),
    criarQuebraPagina(),
    criarTituloSecao("RESUMO DAS ATIVIDADES"),
    criarTabelaResumoMensal(linhasResumo),
    criarQuebraPagina(),
    new Paragraph({
      spacing: { before: 80, after: 160 },
      children: [run("ATIVIDADES REALIZADAS", { bold: true, size: 28, color: COR.primaria })],
    }),
  ];

  atividades.forEach((atividade, indice) => {
    corpo.push(
      ...criarBlocoAtividadeMensal(atividade, indice, atividade.fotos, { quebrarAntes: indice > 0 })
    );
  });

  corpo.push(
    new Paragraph({
      spacing: { before: 400 },
      children: [
        run(`Relatório gerado em ${formatarDataCancelamento(new Date())}`, {
          italics: true,
          size: 18,
          color: COR.suave,
        }),
      ],
    })
  );

  const documento = new Document({
    creator: "UNISOL RS",
    title: "Relatório Mensal de Atividades",
    description: "Relatório mensal institucional da UNISOL RS",
    styles: estilosDocumentoPadrao(),
    sections: [
      {
        properties: {
          titlePage: true,
          page: propriedadesPaginaA4(),
        },
        headers: {
          first: new Header({ children: [new Paragraph({ children: [run("")] })] }),
          default: criarCabecalhoDiscreto("UNISOL RS — Relatório Mensal de Atividades"),
        },
        footers: {
          first: new Footer({ children: [new Paragraph({ children: [run("")] })] }),
          default: criarRodape({ texto: "UNISOL RS — Relatório Mensal de Atividades" }),
        },
        children: corpo,
      },
    ],
  });

  avisar("Finalizando Word...", 96);

  try {
    const blob = await Packer.toBlob(documento);
    baixarBlob(blob, nomeArquivoRelatorioMensal(ano, mes, mobilizadorNome));
    avisar("Relatório pronto.", 100);
    return blob;
  } catch (erro) {
    throw new ErroRelatorioWord(MENSAGEM_MENSAL, { causa: erro });
  }
}

export function resumirTextoRelatorio(texto, limite = 80) {
  const limpo = String(texto || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!limpo) {
    return "Atividade sem descrição";
  }

  if (limpo.length <= limite) {
    return limpo;
  }

  const corte = limpo.slice(0, limite);
  const ultimoEspaco = corte.lastIndexOf(" ");
  const base = ultimoEspaco > 40 ? corte.slice(0, ultimoEspaco) : corte;
  return `${base}…`;
}
