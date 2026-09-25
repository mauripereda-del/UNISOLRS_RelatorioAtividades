import { obterUrlRedefinicaoSenha } from "./config.js";
import { obterClienteSupabase } from "./supabase.js";

export async function obterSessao() {
  const supabase = obterClienteSupabase();
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    throw error;
  }

  return data.session;
}

export async function entrar(email, senha) {
  const supabase = obterClienteSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: senha,
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function sair() {
  const supabase = obterClienteSupabase();
  const { error } = await supabase.auth.signOut();

  if (error) {
    throw error;
  }
}

export async function enviarRecuperacaoSenha(email) {
  const supabase = obterClienteSupabase();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: obterUrlRedefinicaoSenha(),
  });

  if (error) {
    throw error;
  }
}

export async function atualizarSenha(novaSenha) {
  const supabase = obterClienteSupabase();
  const { data, error } = await supabase.auth.updateUser({
    password: novaSenha,
  });

  if (error) {
    throw error;
  }

  return data;
}

export function observarAutenticacao(callback) {
  const supabase = obterClienteSupabase();
  return supabase.auth.onAuthStateChange(callback);
}
