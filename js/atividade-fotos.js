import { FOTOS } from "./config.js";
import { obterClienteSupabase } from "./supabase.js";

const ASSINATURA_JPEG = [0xff, 0xd8, 0xff];
const ASSINATURA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function extensaoArquivo(nome) {
  const encontrado = String(nome || "")
    .toLowerCase()
    .match(/(\.[a-z0-9]+)$/);
  return encontrado ? encontrado[1] : "";
}

function mimeDaExtensao(extensao) {
  if (extensao === ".jpg" || extensao === ".jpeg") {
    return "image/jpeg";
  }

  if (extensao === ".png") {
    return "image/png";
  }

  return "";
}

function mimeDoNavegador(tipo) {
  const valor = String(tipo || "").toLowerCase();

  if (valor === "image/jpg" || valor === "image/jpeg") {
    return "image/jpeg";
  }

  if (valor === "image/png") {
    return "image/png";
  }

  return valor;
}

function extensaoDoMime(mime) {
  return mime === "image/png" ? ".png" : ".jpg";
}

function arraysIguais(a, b) {
  return a.length === b.length && a.every((valor, indice) => valor === b[indice]);
}

async function lerAssinatura(arquivo) {
  const buffer = await arquivo.slice(0, 8).arrayBuffer();
  return Array.from(new Uint8Array(buffer));
}

function mimeDaAssinatura(bytes) {
  if (bytes.length >= 3 && arraysIguais(bytes.slice(0, 3), ASSINATURA_JPEG)) {
    return "image/jpeg";
  }

  if (bytes.length >= 8 && arraysIguais(bytes.slice(0, 8), ASSINATURA_PNG)) {
    return "image/png";
  }

  return "";
}

function sanitizarNome(nome) {
  const base = String(nome || "fotografia")
    .replace(/[/\\]/g, "")
    .replace(/[^\w.\- ()áéíóúâêôãõçÁÉÍÓÚÂÊÔÃÕÇ]/gi, "_")
    .trim();

  return (base || "fotografia").slice(0, 180);
}

export function formatarTamanhoArquivo(bytes) {
  const valor = Number(bytes) || 0;

  if (valor < 1024) {
    return `${valor} B`;
  }

  if (valor < 1024 * 1024) {
    return `${(valor / 1024).toFixed(1)} KB`;
  }

  return `${(valor / (1024 * 1024)).toFixed(1)} MB`;
}

export function mensagemErroFoto(erro) {
  const mensagem = String(erro?.message || "");
  const codigo = String(erro?.code || "");
  const status = Number(erro?.statusCode || erro?.status || 0);

  if (mensagem.includes("máximo de 3 fotografias")) {
    return "Esta atividade já possui o máximo de 3 fotografias.";
  }

  if (mensagem.includes("pelo menos uma fotografia")) {
    return "Adicione pelo menos uma fotografia antes de concluir a atividade.";
  }

  if (
    mensagem.includes("atividade_fotos_legenda_check") ||
    mensagem.includes("value too long")
  ) {
    return "A legenda pode ter no máximo 200 caracteres.";
  }

  if (
    codigo === "42501" ||
    status === 403 ||
    mensagem.toLowerCase().includes("row-level security") ||
    mensagem.toLowerCase().includes("permission") ||
    mensagem.includes("não possui permissão")
  ) {
    return "Você não possui permissão para alterar as fotografias desta atividade.";
  }

  if (
    mensagem.toLowerCase().includes("payload too large") ||
    mensagem.toLowerCase().includes("maximum allowed size") ||
    mensagem.toLowerCase().includes("file size")
  ) {
    return "A fotografia excede o limite de 5 MB.";
  }

  if (
    mensagem.toLowerCase().includes("mime") ||
    mensagem.toLowerCase().includes("invalid")
  ) {
    return "Formato de arquivo não permitido. Utilize JPG, JPEG ou PNG.";
  }

  if (mensagem && !codigo && !mensagem.includes("violates") && !mensagem.includes("relation")) {
    return mensagem;
  }

  return "Não foi possível enviar a fotografia. Tente novamente.";
}

export function validarArquivo(arquivo) {
  if (!arquivo) {
    return { ok: false, mensagem: "Selecione uma fotografia válida." };
  }

  if (arquivo.size > FOTOS.maxBytes) {
    return { ok: false, mensagem: "A fotografia excede o limite de 5 MB." };
  }

  const extensao = extensaoArquivo(arquivo.name);
  if (extensao && !FOTOS.extensoesPermitidas.includes(extensao)) {
    return {
      ok: false,
      mensagem: "Formato de arquivo não permitido. Utilize JPG, JPEG ou PNG.",
    };
  }

  const mimeInformado = mimeDoNavegador(arquivo.type);
  if (mimeInformado && !FOTOS.mimesPermitidos.includes(mimeInformado)) {
    return {
      ok: false,
      mensagem: "Formato de arquivo não permitido. Utilize JPG, JPEG ou PNG.",
    };
  }

  const mimeExtensao = mimeDaExtensao(extensao);
  if (mimeInformado && mimeExtensao && mimeInformado !== mimeExtensao) {
    return {
      ok: false,
      mensagem: "Formato de arquivo não permitido. Utilize JPG, JPEG ou PNG.",
    };
  }

  return { ok: true };
}

export async function validarArquivoCompleto(arquivo) {
  const basico = validarArquivo(arquivo);
  if (!basico.ok) {
    return basico;
  }

  const bytes = await lerAssinatura(arquivo);
  const mimeReal = mimeDaAssinatura(bytes);

  if (!FOTOS.mimesPermitidos.includes(mimeReal)) {
    return {
      ok: false,
      mensagem: "Formato de arquivo não permitido. Utilize JPG, JPEG ou PNG.",
    };
  }

  const mimeInformado = mimeDoNavegador(arquivo.type);
  const mimeExtensao = mimeDaExtensao(extensaoArquivo(arquivo.name));

  if (mimeInformado && mimeInformado !== mimeReal) {
    return {
      ok: false,
      mensagem: "Formato de arquivo não permitido. Utilize JPG, JPEG ou PNG.",
    };
  }

  if (mimeExtensao && mimeExtensao !== mimeReal) {
    return {
      ok: false,
      mensagem: "Formato de arquivo não permitido. Utilize JPG, JPEG ou PNG.",
    };
  }

  return {
    ok: true,
    mime: mimeReal,
    extensao: extensaoDoMime(mimeReal),
  };
}

export async function listarFotos(atividadeId) {
  if (!atividadeId) {
    return [];
  }

  const supabase = obterClienteSupabase();
  const { data, error } = await supabase
    .from("atividade_fotos")
    .select(
      "id, atividade_id, storage_path, nome_arquivo, mime_type, tamanho_bytes, legenda, ordem, created_at, updated_at"
    )
    .eq("atividade_id", atividadeId)
    .order("ordem", { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}

export async function gerarUrlVisualizacao(storagePath) {
  if (!storagePath) {
    return "";
  }

  const supabase = obterClienteSupabase();
  const { data, error } = await supabase.storage
    .from(FOTOS.bucket)
    .createSignedUrl(storagePath, FOTOS.urlAssinadaSegundos);

  if (error || !data?.signedUrl) {
    return "";
  }

  return data.signedUrl;
}

export async function enviarFoto({ atividade, arquivo, ordem, mime, extensao }) {
  if (!atividade?.id || !atividade?.usuario_id) {
    throw new Error("Não foi possível enviar a fotografia. Tente novamente.");
  }

  const validacao =
    mime && extensao
      ? { ok: true, mime, extensao }
      : await validarArquivoCompleto(arquivo);

  if (!validacao.ok) {
    throw new Error(validacao.mensagem);
  }

  const supabase = obterClienteSupabase();
  const storagePath = `${atividade.usuario_id}/${atividade.id}/${crypto.randomUUID()}${validacao.extensao}`;

  const { error: erroUpload } = await supabase.storage.from(FOTOS.bucket).upload(storagePath, arquivo, {
    cacheControl: "3600",
    upsert: false,
    contentType: validacao.mime,
  });

  if (erroUpload) {
    throw erroUpload;
  }

  const { data, error } = await supabase
    .from("atividade_fotos")
    .insert({
      atividade_id: atividade.id,
      storage_path: storagePath,
      nome_arquivo: sanitizarNome(arquivo.name),
      mime_type: validacao.mime,
      tamanho_bytes: arquivo.size,
      legenda: null,
      ordem,
    })
    .select("*")
    .single();

  if (error) {
    await supabase.storage.from(FOTOS.bucket).remove([storagePath]);
    throw error;
  }

  return data;
}

export async function removerFoto(foto) {
  if (!foto?.id) {
    throw new Error("Não foi possível remover a fotografia.");
  }

  const supabase = obterClienteSupabase();
  const { error } = await supabase.from("atividade_fotos").delete().eq("id", foto.id);

  if (error) {
    throw error;
  }

  if (foto.storage_path) {
    await supabase.storage.from(FOTOS.bucket).remove([foto.storage_path]);
  }
}

export async function atualizarLegenda(fotoId, legenda) {
  const texto = String(legenda || "").trim();

  if (texto.length > FOTOS.maxLegenda) {
    throw new Error("A legenda pode ter no máximo 200 caracteres.");
  }

  const supabase = obterClienteSupabase();
  const { data, error } = await supabase
    .from("atividade_fotos")
    .update({ legenda: texto || null })
    .eq("id", fotoId)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function atualizarOrdem(atividadeId, ids) {
  const supabase = obterClienteSupabase();
  const { error } = await supabase.rpc("reorganizar_fotos", {
    p_atividade_id: atividadeId,
    p_ids: ids,
  });

  if (error) {
    throw error;
  }
}
