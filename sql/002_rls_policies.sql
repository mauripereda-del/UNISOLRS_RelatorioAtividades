-- UNISOL RS — Relatório de Atividades
-- Script 002: RLS da tabela profiles.
-- Execute DEPOIS de 001_initial_schema.sql.
-- Idempotente: políticas são recriadas.

-- Decisão de segurança:
-- Verificar ADMIN consultando a própria tabela profiles dentro de uma policy
-- de SELECT/UPDATE em profiles causa recursão infinita de RLS.
-- Por isso usamos a função SECURITY DEFINER eh_administrador(),
-- que consulta profiles com privilégio do dono e ignora RLS.
-- A função só considera o usuário autenticado atual, ATIVO e com perfil ADMIN.

CREATE OR REPLACE FUNCTION public.eh_administrador()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND perfil = 'ADMIN'
      AND status = 'ATIVO'
  );
$$;

REVOKE ALL ON FUNCTION public.eh_administrador() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eh_administrador() TO authenticated;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select_proprio_ou_admin ON public.profiles;
CREATE POLICY profiles_select_proprio_ou_admin
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid() OR public.eh_administrador());

DROP POLICY IF EXISTS profiles_update_proprio_ou_admin ON public.profiles;
CREATE POLICY profiles_update_proprio_ou_admin
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid() OR public.eh_administrador())
  WITH CHECK (id = auth.uid() OR public.eh_administrador());

DROP POLICY IF EXISTS profiles_insert_apenas_admin ON public.profiles;
CREATE POLICY profiles_insert_apenas_admin
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (public.eh_administrador());

-- Sem policy de DELETE: exclusão pelo cliente autenticado fica bloqueada pelo RLS.

-- Observação:
-- 001 cria o trigger que chama eh_administrador().
-- Se 002 ainda não tiver sido executado, rode os dois scripts em ordem
-- (001 e em seguida 002) e, se necessário, reexecute 001 para recriar o trigger.
