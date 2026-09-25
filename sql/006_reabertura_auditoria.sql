-- UNISOL RS — Relatório de Atividades
-- Script 006: solicitações de reabertura + auditoria.
-- Execute DEPOIS de 001, 002, 003 e 004.
-- Não apaga atividades, fotos, policies de profiles nem o bucket.

-- Decisões:
-- 1. Reabertura CONCLUIDA → RASCUNHO só pela RPC aprovar_reabertura.
-- 2. proteger_atividades() ganha um gate específico; as demais regras
--    (dono, status, 300/500/500, foto obrigatória, ADMIN/MOBILIZADOR) permanecem.
-- 3. Auditoria é imutável: sem UPDATE/DELETE e sem INSERT direto pelo cliente.
-- 4. UNIQUE parcial impede duas PENDENTE na mesma atividade.

CREATE TABLE IF NOT EXISTS public.solicitacoes_reabertura (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  atividade_id UUID NOT NULL REFERENCES public.atividades (id) ON DELETE RESTRICT,
  solicitante_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  motivo TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDENTE',
  solicitado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  analisado_por UUID REFERENCES auth.users (id) ON DELETE RESTRICT,
  analisado_em TIMESTAMPTZ,
  observacao_admin TEXT,
  fila_analise SMALLINT GENERATED ALWAYS AS (
    CASE WHEN status = 'PENDENTE' THEN 0 ELSE 1 END
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT solicitacoes_reabertura_status_check
    CHECK (status IN ('PENDENTE', 'APROVADA', 'RECUSADA')),
  CONSTRAINT solicitacoes_reabertura_motivo_check
    CHECK (char_length(trim(motivo)) >= 20 AND char_length(motivo) <= 1000),
  CONSTRAINT solicitacoes_reabertura_observacao_max_check
    CHECK (observacao_admin IS NULL OR char_length(observacao_admin) <= 1000),
  CONSTRAINT solicitacoes_reabertura_recusa_observacao_check
    CHECK (
      status <> 'RECUSADA'
      OR char_length(trim(COALESCE(observacao_admin, ''))) >= 10
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS solicitacoes_reabertura_pendente_unica
  ON public.solicitacoes_reabertura (atividade_id)
  WHERE status = 'PENDENTE';

CREATE INDEX IF NOT EXISTS idx_solicitacoes_reabertura_atividade
  ON public.solicitacoes_reabertura (atividade_id);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_reabertura_status_fila
  ON public.solicitacoes_reabertura (fila_analise, solicitado_em);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_reabertura_solicitante
  ON public.solicitacoes_reabertura (solicitante_id);

CREATE TABLE IF NOT EXISTS public.auditoria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  atividade_id UUID REFERENCES public.atividades (id) ON DELETE RESTRICT,
  entidade TEXT NOT NULL,
  entidade_id UUID,
  acao TEXT NOT NULL,
  detalhes JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_atividade_created
  ON public.auditoria (atividade_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_usuario
  ON public.auditoria (usuario_id);

CREATE OR REPLACE FUNCTION public.eh_mobilizador_ativo()
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
      AND perfil = 'MOBILIZADOR'
      AND status = 'ATIVO'
  );
$$;

REVOKE ALL ON FUNCTION public.eh_mobilizador_ativo() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eh_mobilizador_ativo() TO authenticated;

CREATE OR REPLACE FUNCTION public.registrar_auditoria(
  p_usuario_id UUID,
  p_atividade_id UUID,
  p_entidade TEXT,
  p_entidade_id UUID,
  p_acao TEXT,
  p_detalhes JSONB DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.auditoria (
    usuario_id, atividade_id, entidade, entidade_id, acao, detalhes, created_at
  ) VALUES (
    p_usuario_id, p_atividade_id, p_entidade, p_entidade_id, p_acao, p_detalhes, now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_auditoria(UUID, UUID, TEXT, UUID, TEXT, JSONB) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.impedir_mutacao_auditoria()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Registros de auditoria são imutáveis.';
END;
$$;

DROP TRIGGER IF EXISTS trg_impedir_update_auditoria ON public.auditoria;
CREATE TRIGGER trg_impedir_update_auditoria
  BEFORE UPDATE ON public.auditoria
  FOR EACH ROW
  EXECUTE FUNCTION public.impedir_mutacao_auditoria();

DROP TRIGGER IF EXISTS trg_impedir_delete_auditoria ON public.auditoria;
CREATE TRIGGER trg_impedir_delete_auditoria
  BEFORE DELETE ON public.auditoria
  FOR EACH ROW
  EXECUTE FUNCTION public.impedir_mutacao_auditoria();

-- Recria proteger_atividades: mesmas regras de 004 + gate de reabertura + auditoria admin.
CREATE OR REPLACE FUNCTION public.proteger_atividades()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  campos TEXT[] := ARRAY[]::TEXT[];
BEGIN
  NEW.id := OLD.id;
  NEW.usuario_id := OLD.usuario_id;
  NEW.created_at := OLD.created_at;
  NEW.updated_at := now();

  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'CONCLUIDA' AND NEW.status = 'RASCUNHO' THEN
    IF current_setting('unisol.reabertura_autorizada', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'A reabertura deve ser feita pela análise administrativa da solicitação.';
    END IF;
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

  IF NEW.status = 'CONCLUIDA'
     AND NOT EXISTS (
       SELECT 1 FROM public.atividade_fotos WHERE atividade_id = NEW.id
     )
  THEN
    RAISE EXCEPTION 'Adicione pelo menos uma fotografia antes de concluir a atividade.';
  END IF;

  IF public.eh_administrador()
     AND OLD.usuario_id IS DISTINCT FROM auth.uid()
     AND current_setting('unisol.reabertura_autorizada', true) IS DISTINCT FROM 'on'
  THEN
    IF NEW.data_atividade IS DISTINCT FROM OLD.data_atividade THEN
      campos := campos || 'data_atividade';
    END IF;
    IF NEW.introducao IS DISTINCT FROM OLD.introducao THEN
      campos := campos || 'introducao';
    END IF;
    IF NEW.descricao IS DISTINCT FROM OLD.descricao THEN
      campos := campos || 'descricao';
    END IF;
    IF NEW.conclusao IS DISTINCT FROM OLD.conclusao THEN
      campos := campos || 'conclusao';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      campos := campos || 'status';
    END IF;

    IF array_length(campos, 1) IS NOT NULL THEN
      PERFORM public.registrar_auditoria(
        auth.uid(),
        NEW.id,
        'ATIVIDADE',
        NEW.id,
        'EDICAO_ADMINISTRATIVA',
        jsonb_build_object(
          'campos_alterados', to_jsonb(campos),
          'status', NEW.status
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.auditar_fotos_administrativas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  dono UUID;
  alvo public.atividade_fotos;
BEGIN
  IF NOT public.eh_administrador() THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  alvo := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;

  SELECT usuario_id INTO dono
  FROM public.atividades
  WHERE id = alvo.atividade_id;

  IF dono IS NULL OR dono = auth.uid() THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.registrar_auditoria(
      auth.uid(),
      NEW.atividade_id,
      'FOTO',
      NEW.id,
      'FOTO_ADICIONADA_ADMIN',
      jsonb_build_object(
        'foto_id', NEW.id,
        'nome_arquivo', NEW.nome_arquivo,
        'ordem', NEW.ordem
      )
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.legenda IS DISTINCT FROM OLD.legenda THEN
    PERFORM public.registrar_auditoria(
      auth.uid(),
      NEW.atividade_id,
      'FOTO',
      NEW.id,
      'FOTO_LEGENDA_ALTERADA_ADMIN',
      jsonb_build_object(
        'foto_id', NEW.id,
        'nome_arquivo', NEW.nome_arquivo,
        'ordem', NEW.ordem,
        'campos_alterados', jsonb_build_array('legenda')
      )
    );
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.registrar_auditoria(
      auth.uid(),
      OLD.atividade_id,
      'FOTO',
      OLD.id,
      'FOTO_REMOVIDA_ADMIN',
      jsonb_build_object(
        'foto_id', OLD.id,
        'nome_arquivo', OLD.nome_arquivo,
        'ordem', OLD.ordem
      )
    );
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auditar_fotos_administrativas ON public.atividade_fotos;
CREATE TRIGGER trg_auditar_fotos_administrativas
  AFTER INSERT OR UPDATE OR DELETE ON public.atividade_fotos
  FOR EACH ROW
  EXECUTE FUNCTION public.auditar_fotos_administrativas();

CREATE OR REPLACE FUNCTION public.reorganizar_fotos(p_atividade_id UUID, p_ids UUID[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  i INTEGER;
  dono UUID;
BEGIN
  IF NOT public.pode_gerenciar_fotos_atividade(p_atividade_id) THEN
    RAISE EXCEPTION 'Você não possui permissão para alterar as fotografias desta atividade.';
  END IF;

  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  SET CONSTRAINTS atividade_fotos_atividade_ordem_unique DEFERRED;

  FOR i IN 1 .. array_length(p_ids, 1) LOOP
    UPDATE public.atividade_fotos
    SET ordem = i,
        updated_at = now()
    WHERE id = p_ids[i]
      AND atividade_id = p_atividade_id;
  END LOOP;

  SELECT usuario_id INTO dono
  FROM public.atividades
  WHERE id = p_atividade_id;

  IF public.eh_administrador() AND dono IS DISTINCT FROM auth.uid() THEN
    PERFORM public.registrar_auditoria(
      auth.uid(),
      p_atividade_id,
      'FOTO',
      p_atividade_id,
      'FOTO_REORDENADA_ADMIN',
      jsonb_build_object('ordens', to_jsonb(p_ids))
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.solicitar_reabertura(p_atividade_id UUID, p_motivo TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  atividade public.atividades;
  motivo TEXT;
  novo_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Você não possui permissão para solicitar reabertura.';
  END IF;

  IF NOT public.eh_mobilizador_ativo() THEN
    RAISE EXCEPTION 'Somente mobilizador ativo pode solicitar reabertura.';
  END IF;

  motivo := trim(COALESCE(p_motivo, ''));
  IF char_length(motivo) < 20 OR char_length(motivo) > 1000 THEN
    RAISE EXCEPTION 'O motivo deve possuir entre 20 e 1000 caracteres.';
  END IF;

  SELECT * INTO atividade
  FROM public.atividades
  WHERE id = p_atividade_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Atividade não encontrada ou você não possui acesso a ela.';
  END IF;

  IF atividade.usuario_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Você não possui permissão para solicitar reabertura.';
  END IF;

  IF atividade.status IS DISTINCT FROM 'CONCLUIDA' THEN
    RAISE EXCEPTION 'Somente atividades concluídas podem solicitar reabertura.';
  END IF;

  BEGIN
    INSERT INTO public.solicitacoes_reabertura (
      atividade_id, solicitante_id, motivo, status, solicitado_em
    ) VALUES (
      atividade.id, auth.uid(), motivo, 'PENDENTE', now()
    )
    RETURNING id INTO novo_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Já existe uma solicitação de reabertura pendente para esta atividade.';
  END;

  PERFORM public.registrar_auditoria(
    auth.uid(),
    atividade.id,
    'SOLICITACAO_REABERTURA',
    novo_id,
    'SOLICITOU_REABERTURA',
    jsonb_build_object('motivo', motivo, 'solicitacao_id', novo_id)
  );

  RETURN novo_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.aprovar_reabertura(p_solicitacao_id UUID, p_observacao TEXT DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  solicitacao public.solicitacoes_reabertura;
  atividade public.atividades;
  observacao TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.eh_administrador() THEN
    RAISE EXCEPTION 'Somente administrador ativo pode analisar solicitações.';
  END IF;

  observacao := nullif(trim(COALESCE(p_observacao, '')), '');
  IF observacao IS NOT NULL AND char_length(observacao) > 1000 THEN
    RAISE EXCEPTION 'A observação pode ter no máximo 1000 caracteres.';
  END IF;

  SELECT * INTO solicitacao
  FROM public.solicitacoes_reabertura
  WHERE id = p_solicitacao_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitação não encontrada.';
  END IF;

  IF solicitacao.status <> 'PENDENTE' THEN
    RAISE EXCEPTION 'Esta solicitação já foi analisada.';
  END IF;

  SELECT * INTO atividade
  FROM public.atividades
  WHERE id = solicitacao.atividade_id
  FOR UPDATE;

  IF NOT FOUND OR atividade.status <> 'CONCLUIDA' THEN
    RAISE EXCEPTION 'A atividade não está mais concluída e não pode ser reaberta por esta solicitação.';
  END IF;

  UPDATE public.solicitacoes_reabertura
  SET
    status = 'APROVADA',
    analisado_por = auth.uid(),
    analisado_em = now(),
    observacao_admin = observacao,
    updated_at = now()
  WHERE id = solicitacao.id;

  PERFORM set_config('unisol.reabertura_autorizada', 'on', true);

  UPDATE public.atividades
  SET status = 'RASCUNHO'
  WHERE id = atividade.id;

  PERFORM public.registrar_auditoria(
    auth.uid(),
    atividade.id,
    'SOLICITACAO_REABERTURA',
    solicitacao.id,
    'APROVOU_REABERTURA',
    jsonb_build_object(
      'solicitacao_id', solicitacao.id,
      'status_anterior', 'CONCLUIDA',
      'status_novo', 'RASCUNHO',
      'observacao_admin', observacao
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.recusar_reabertura(p_solicitacao_id UUID, p_observacao TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  solicitacao public.solicitacoes_reabertura;
  observacao TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.eh_administrador() THEN
    RAISE EXCEPTION 'Somente administrador ativo pode analisar solicitações.';
  END IF;

  observacao := trim(COALESCE(p_observacao, ''));
  IF char_length(observacao) < 10 OR char_length(observacao) > 1000 THEN
    RAISE EXCEPTION 'O motivo da recusa deve possuir entre 10 e 1000 caracteres.';
  END IF;

  SELECT * INTO solicitacao
  FROM public.solicitacoes_reabertura
  WHERE id = p_solicitacao_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitação não encontrada.';
  END IF;

  IF solicitacao.status <> 'PENDENTE' THEN
    RAISE EXCEPTION 'Esta solicitação já foi analisada.';
  END IF;

  UPDATE public.solicitacoes_reabertura
  SET
    status = 'RECUSADA',
    analisado_por = auth.uid(),
    analisado_em = now(),
    observacao_admin = observacao,
    updated_at = now()
  WHERE id = solicitacao.id;

  PERFORM public.registrar_auditoria(
    auth.uid(),
    solicitacao.atividade_id,
    'SOLICITACAO_REABERTURA',
    solicitacao.id,
    'RECUSOU_REABERTURA',
    jsonb_build_object(
      'solicitacao_id', solicitacao.id,
      'observacao_admin', observacao
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.solicitar_reabertura(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aprovar_reabertura(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recusar_reabertura(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.solicitar_reabertura(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aprovar_reabertura(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recusar_reabertura(UUID, TEXT) TO authenticated;

ALTER TABLE public.solicitacoes_reabertura ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solicitacoes_reabertura FORCE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS solicitacoes_reabertura_select ON public.solicitacoes_reabertura;
CREATE POLICY solicitacoes_reabertura_select
  ON public.solicitacoes_reabertura
  FOR SELECT
  TO authenticated
  USING (
    public.eh_administrador()
    OR solicitante_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.atividades a
      WHERE a.id = atividade_id
        AND a.usuario_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS auditoria_select ON public.auditoria;
CREATE POLICY auditoria_select
  ON public.auditoria
  FOR SELECT
  TO authenticated
  USING (
    public.eh_administrador()
    OR (
      atividade_id IS NOT NULL
      AND acao IN ('SOLICITOU_REABERTURA', 'APROVOU_REABERTURA', 'RECUSOU_REABERTURA')
      AND EXISTS (
        SELECT 1
        FROM public.atividades a
        WHERE a.id = atividade_id
          AND a.usuario_id = auth.uid()
      )
    )
  );

REVOKE ALL ON TABLE public.solicitacoes_reabertura FROM PUBLIC;
REVOKE ALL ON TABLE public.auditoria FROM PUBLIC;
GRANT SELECT ON TABLE public.solicitacoes_reabertura TO authenticated;
GRANT SELECT ON TABLE public.auditoria TO authenticated;
