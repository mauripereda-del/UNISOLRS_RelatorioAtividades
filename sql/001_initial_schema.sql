-- UNISOL RS — Relatório de Atividades
-- Script 001: estrutura inicial de perfis.
-- Execute no SQL Editor do Supabase.
-- Idempotente: pode ser reexecutado com segurança nesta etapa.

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  email TEXT,
  telefone TEXT,
  perfil TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT profiles_perfil_check CHECK (perfil IN ('ADMIN', 'MOBILIZADOR')),
  CONSTRAINT profiles_status_check CHECK (status IN ('ATIVO', 'INATIVO'))
);

COMMENT ON TABLE public.profiles IS
  'Perfil de aplicação vinculado a auth.users. A senha permanece apenas no Supabase Auth.';
COMMENT ON COLUMN public.profiles.id IS
  'Mesmo UUID de auth.users.id.';
COMMENT ON COLUMN public.profiles.perfil IS
  'ADMIN ou MOBILIZADOR.';
COMMENT ON COLUMN public.profiles.status IS
  'ATIVO ou INATIVO. Usuário INATIVO não acessa a aplicação.';

CREATE INDEX IF NOT EXISTS idx_profiles_perfil ON public.profiles (perfil);
CREATE INDEX IF NOT EXISTS idx_profiles_status ON public.profiles (status);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles (email);

-- Novos usuários do Auth entram como MOBILIZADOR/INATIVO até um admin ativá-los.
CREATE OR REPLACE FUNCTION public.criar_profile_novo_usuario()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, nome, email, perfil, status)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nome', split_part(COALESCE(NEW.email, 'usuario'), '@', 1), 'Usuário'),
    NEW.email,
    'MOBILIZADOR',
    'INATIVO'
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.criar_profile_novo_usuario();

-- Função SECURITY DEFINER para checar ADMIN sem recursão de RLS.
-- Recriada também em 002_rls_policies.sql.
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

-- Impede que um mobilizador altere o próprio perfil/status.
-- Operações sem auth.uid() (SQL Editor / service role) não são bloqueadas.
CREATE OR REPLACE FUNCTION public.proteger_campos_sensiveis_profiles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.id := OLD.id;
  NEW.updated_at := now();

  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.eh_administrador() THEN
    IF NEW.perfil IS DISTINCT FROM OLD.perfil THEN
      RAISE EXCEPTION 'Não é permitido alterar o próprio perfil de acesso.';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Não é permitido alterar o próprio status.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proteger_campos_sensiveis_profiles ON public.profiles;
CREATE TRIGGER trg_proteger_campos_sensiveis_profiles
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.proteger_campos_sensiveis_profiles();

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;

-- Exemplo para promover o primeiro administrador (substitua o UUID):
-- UPDATE public.profiles
-- SET nome = 'Administrador',
--     email = 'admin@exemplo.com',
--     perfil = 'ADMIN',
--     status = 'ATIVO'
-- WHERE id = '00000000-0000-0000-0000-000000000000';

-- Contexto futuro (NÃO criar nestes scripts):
-- atividades (usuario_id, data_atividade, introducao >= 300, descricao >= 500,
--   conclusao >= 500, status RASCUNHO|CONCLUIDA|CANCELADA, sem exclusão física)
-- atividade_fotos (1 a 3 arquivos JPG/JPEG/PNG, legenda opcional)
-- reabertura, auditoria e relatórios Word serão tratados em etapas posteriores.
