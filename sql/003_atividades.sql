-- UNISOL RS — Relatório de Atividades
-- Script 003: tabela atividades, constraints, triggers e RLS.
-- Execute DEPOIS de 001_initial_schema.sql e 002_rls_policies.sql.
-- Idempotente o suficiente para esta etapa. Não apaga profiles nem policies anteriores.

-- Decisão de segurança:
-- 1. RLS define QUEM vê/insere/atualiza (próprio registro ou ADMIN ativo).
-- 2. Trigger BEFORE UPDATE impede O QUE o MOBILIZADOR pode mudar
--    (status, proprietário, edição de CONCLUIDA/CANCELADA).
-- 3. CHECK no banco exige 300/500/500 quando status = CONCLUIDA.
-- 4. Reutilizamos public.eh_administrador() (SECURITY DEFINER) para
--    não consultar profiles de forma recursiva nas policies de atividades.

CREATE TABLE IF NOT EXISTS public.atividades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  data_atividade DATE NOT NULL,
  introducao TEXT,
  descricao TEXT,
  conclusao TEXT,
  status TEXT NOT NULL DEFAULT 'RASCUNHO',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT atividades_status_check CHECK (status IN ('RASCUNHO', 'CONCLUIDA', 'CANCELADA'))
);

COMMENT ON TABLE public.atividades IS
  'Relatos de atividade. Sem exclusão física nesta etapa. Fotos virão no Prompt 04.';
COMMENT ON COLUMN public.atividades.usuario_id IS
  'Responsável. Sempre o usuário autenticado na criação. ON DELETE RESTRICT preserva o histórico.';
COMMENT ON COLUMN public.atividades.status IS
  'RASCUNHO, CONCLUIDA ou CANCELADA. Mobilizador só percorre RASCUNHO → CONCLUIDA nesta etapa.';

CREATE INDEX IF NOT EXISTS idx_atividades_usuario_id ON public.atividades (usuario_id);
CREATE INDEX IF NOT EXISTS idx_atividades_status ON public.atividades (status);
CREATE INDEX IF NOT EXISTS idx_atividades_data ON public.atividades (data_atividade);
CREATE INDEX IF NOT EXISTS idx_atividades_updated_at ON public.atividades (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_atividades_usuario_status ON public.atividades (usuario_id, status);

ALTER TABLE public.atividades DROP CONSTRAINT IF EXISTS atividades_concluida_textos_check;
ALTER TABLE public.atividades
  ADD CONSTRAINT atividades_concluida_textos_check
  CHECK (
    status <> 'CONCLUIDA'
    OR (
      char_length(trim(COALESCE(introducao, ''))) >= 300
      AND char_length(trim(COALESCE(descricao, ''))) >= 500
      AND char_length(trim(COALESCE(conclusao, ''))) >= 500
    )
  );

CREATE OR REPLACE FUNCTION public.eh_usuario_ativo()
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
      AND status = 'ATIVO'
  );
$$;

REVOKE ALL ON FUNCTION public.eh_usuario_ativo() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eh_usuario_ativo() TO authenticated;

-- Protege proprietário, status e edição indevida. updated_at vem do banco.
CREATE OR REPLACE FUNCTION public.proteger_atividades()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.id := OLD.id;
  NEW.usuario_id := OLD.usuario_id;
  NEW.created_at := OLD.created_at;
  NEW.updated_at := now();

  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.eh_administrador() THEN
    IF OLD.status IN ('CONCLUIDA', 'CANCELADA') THEN
      RAISE EXCEPTION 'Você não possui permissão para editar esta atividade.';
    END IF;

    IF NEW.status = 'CANCELADA' THEN
      RAISE EXCEPTION 'Você não possui permissão para cancelar esta atividade.';
    END IF;

    IF OLD.status = 'RASCUNHO' AND NEW.status NOT IN ('RASCUNHO', 'CONCLUIDA') THEN
      RAISE EXCEPTION 'Transição de status não permitida para este usuário.';
    END IF;
  END IF;

  -- TODO: registrar edição administrativa na auditoria.

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proteger_atividades ON public.atividades;
CREATE TRIGGER trg_proteger_atividades
  BEFORE UPDATE ON public.atividades
  FOR EACH ROW
  EXECUTE FUNCTION public.proteger_atividades();

ALTER TABLE public.atividades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atividades FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS atividades_select_proprio_ou_admin ON public.atividades;
CREATE POLICY atividades_select_proprio_ou_admin
  ON public.atividades
  FOR SELECT
  TO authenticated
  USING (usuario_id = auth.uid() OR public.eh_administrador());

DROP POLICY IF EXISTS atividades_insert_proprio_ativo ON public.atividades;
CREATE POLICY atividades_insert_proprio_ativo
  ON public.atividades
  FOR INSERT
  TO authenticated
  WITH CHECK (
    usuario_id = auth.uid()
    AND public.eh_usuario_ativo()
  );

DROP POLICY IF EXISTS atividades_update_rascunho_proprio_ou_admin ON public.atividades;
CREATE POLICY atividades_update_rascunho_proprio_ou_admin
  ON public.atividades
  FOR UPDATE
  TO authenticated
  USING (
    public.eh_administrador()
    OR (
      usuario_id = auth.uid()
      AND status = 'RASCUNHO'
      AND public.eh_usuario_ativo()
    )
  )
  WITH CHECK (
    public.eh_administrador()
    OR (
      usuario_id = auth.uid()
      AND status IN ('RASCUNHO', 'CONCLUIDA')
      AND public.eh_usuario_ativo()
    )
  );

-- Sem policy de DELETE: o cliente autenticado não exclui atividades.

GRANT SELECT, INSERT, UPDATE ON TABLE public.atividades TO authenticated;
