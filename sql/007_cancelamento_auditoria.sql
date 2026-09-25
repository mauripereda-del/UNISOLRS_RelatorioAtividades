-- UNISOL RS — Relatório de Atividades
-- Script 007: cancelamento administrativo + consolidação da auditoria.
-- Execute DEPOIS de sql/006_1_ajustes_reabertura.sql.
-- Incremental. Não apaga dados, tabelas, fotos, solicitações nem auditoria.

-- 1) Campos de estado atual do cancelamento (a auditoria permanece o histórico imutável).

ALTER TABLE public.atividades
  ADD COLUMN IF NOT EXISTS cancelada_por UUID,
  ADD COLUMN IF NOT EXISTS cancelada_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS motivo_cancelamento TEXT;

ALTER TABLE public.atividades
  DROP CONSTRAINT IF EXISTS atividades_cancelada_por_fkey;

ALTER TABLE public.atividades
  ADD CONSTRAINT atividades_cancelada_por_fkey
  FOREIGN KEY (cancelada_por)
  REFERENCES auth.users (id)
  ON DELETE RESTRICT;

COMMENT ON COLUMN public.atividades.cancelada_por IS
  'Administrador que cancelou. ON DELETE RESTRICT preserva o histórico.';
COMMENT ON COLUMN public.atividades.cancelada_em IS
  'Data/hora do cancelamento, preenchida somente pela RPC cancelar_atividade.';
COMMENT ON COLUMN public.atividades.motivo_cancelamento IS
  'Motivo do cancelamento vigente (50–1000). O histórico imutável fica em auditoria.';

-- Consistência: CANCELADA exige os três campos; demais status os deixam nulos.
-- Se existir CANCELADA antiga sem esses campos, a constraint não é criada
-- para não inventar motivo nem apagar o registro.

ALTER TABLE public.atividades
  DROP CONSTRAINT IF EXISTS atividades_cancelamento_consistencia_check;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.atividades
    WHERE status = 'CANCELADA'
      AND (
        cancelada_por IS NULL
        OR cancelada_em IS NULL
        OR motivo_cancelamento IS NULL
      )
  ) THEN
    RAISE NOTICE 'Constraint de consistência omitida: há CANCELADA sem campos de cancelamento.';
    RETURN;
  END IF;

  ALTER TABLE public.atividades
    ADD CONSTRAINT atividades_cancelamento_consistencia_check
    CHECK (
      (
        status IS DISTINCT FROM 'CANCELADA'
        AND cancelada_por IS NULL
        AND cancelada_em IS NULL
        AND motivo_cancelamento IS NULL
      )
      OR (
        status = 'CANCELADA'
        AND cancelada_por IS NOT NULL
        AND cancelada_em IS NOT NULL
        AND char_length(trim(motivo_cancelamento)) >= 50
        AND char_length(motivo_cancelamento) <= 1000
      )
    );
END;
$$;

-- 2) proteger_atividades: mesmas regras de 006 + gate de cancelamento.
-- Motivo da alteração: CANCELADA é estado final e a transição só pode
-- ocorrer pela RPC administrativa, sem UPDATE direto do frontend.

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

  IF OLD.status = 'CANCELADA' THEN
    RAISE EXCEPTION 'Atividade cancelada não pode ser alterada.';
  END IF;

  IF NEW.status = 'CANCELADA' AND OLD.status IS DISTINCT FROM 'CANCELADA' THEN
    IF current_setting('unisol.cancelamento_autorizado', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'O cancelamento deve ser feito pela operação administrativa.';
    END IF;
  END IF;

  IF current_setting('unisol.cancelamento_autorizado', true) IS DISTINCT FROM 'on' THEN
    NEW.cancelada_por := OLD.cancelada_por;
    NEW.cancelada_em := OLD.cancelada_em;
    NEW.motivo_cancelamento := OLD.motivo_cancelamento;
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
     AND current_setting('unisol.cancelamento_autorizado', true) IS DISTINCT FROM 'on'
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

-- 3) Fotos: CANCELADA é somente leitura, inclusive para ADMIN.
-- Motivo: Prompt 07 define CANCELADA como estado final.

CREATE OR REPLACE FUNCTION public.pode_gerenciar_fotos_atividade(p_atividade_id UUID)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.atividades a
      WHERE a.id = p_atividade_id
        AND a.status IS DISTINCT FROM 'CANCELADA'
    )
    AND (
      public.eh_administrador()
      OR EXISTS (
        SELECT 1
        FROM public.atividades a
        WHERE a.id = p_atividade_id
          AND a.usuario_id = auth.uid()
          AND a.status = 'RASCUNHO'
          AND public.eh_usuario_ativo()
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.proteger_atividade_fotos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  qtd INTEGER;
  situacao TEXT;
BEGIN
  SELECT status INTO situacao
  FROM public.atividades
  WHERE id = COALESCE(NEW.atividade_id, OLD.atividade_id);

  IF situacao = 'CANCELADA' THEN
    RAISE EXCEPTION 'Fotografias de atividade cancelada não podem ser alteradas.';
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM 1 FROM public.atividades WHERE id = NEW.atividade_id FOR UPDATE;

    SELECT count(*) INTO qtd
    FROM public.atividade_fotos
    WHERE atividade_id = NEW.atividade_id;

    IF qtd >= 3 THEN
      RAISE EXCEPTION 'Esta atividade já possui o máximo de 3 fotografias.';
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.id := OLD.id;
    NEW.atividade_id := OLD.atividade_id;
    NEW.storage_path := OLD.storage_path;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.impedir_remover_ultima_foto_concluida()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  restantes INTEGER;
  situacao TEXT;
BEGIN
  SELECT status INTO situacao
  FROM public.atividades
  WHERE id = OLD.atividade_id;

  IF situacao = 'CANCELADA' THEN
    RAISE EXCEPTION 'Fotografias de atividade cancelada não podem ser alteradas.';
  END IF;

  SELECT count(*) INTO restantes
  FROM public.atividade_fotos
  WHERE atividade_id = OLD.atividade_id
    AND id <> OLD.id;

  IF situacao = 'CONCLUIDA' AND restantes < 1 THEN
    RAISE EXCEPTION 'Atividade concluída deve manter pelo menos uma fotografia.';
  END IF;

  RETURN OLD;
END;
$$;

-- 4) Reabertura: atividade cancelada não solicita nem é aprovada.
-- Motivo: impedir estado inconsistente após o cancelamento.

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
  IF char_length(motivo) < 50 OR char_length(motivo) > 1000 THEN
    RAISE EXCEPTION 'Informe detalhadamente o motivo da reabertura. O motivo deve possuir pelo menos 50 caracteres.';
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

  IF atividade.status = 'CANCELADA' THEN
    RAISE EXCEPTION 'Atividade cancelada não pode solicitar reabertura.';
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

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A atividade não está mais concluída e não pode ser reaberta por esta solicitação.';
  END IF;

  IF atividade.status = 'CANCELADA' THEN
    RAISE EXCEPTION 'A atividade está cancelada e esta solicitação não pode mais ser aprovada.';
  END IF;

  IF atividade.status <> 'CONCLUIDA' THEN
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

-- 5) RPC de cancelamento administrativo.

CREATE OR REPLACE FUNCTION public.cancelar_atividade(p_atividade_id UUID, p_motivo TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  atividade public.atividades;
  motivo TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Você não possui permissão para cancelar esta atividade.';
  END IF;

  IF NOT public.eh_administrador() THEN
    RAISE EXCEPTION 'Somente administrador ativo pode cancelar atividades.';
  END IF;

  motivo := trim(COALESCE(p_motivo, ''));
  IF char_length(motivo) < 50 OR char_length(motivo) > 1000 THEN
    RAISE EXCEPTION 'Informe detalhadamente o motivo do cancelamento. O texto deve possuir pelo menos 50 caracteres.';
  END IF;

  SELECT * INTO atividade
  FROM public.atividades
  WHERE id = p_atividade_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Atividade não encontrada ou você não possui acesso a ela.';
  END IF;

  IF atividade.status = 'CANCELADA' THEN
    RAISE EXCEPTION 'Esta atividade já está cancelada.';
  END IF;

  IF atividade.status NOT IN ('RASCUNHO', 'CONCLUIDA') THEN
    RAISE EXCEPTION 'Somente atividades em rascunho ou concluídas podem ser canceladas.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.solicitacoes_reabertura
    WHERE atividade_id = atividade.id
      AND status = 'PENDENTE'
  ) THEN
    RAISE EXCEPTION 'Esta atividade possui uma solicitação de reabertura pendente. Analise a solicitação antes de cancelar a atividade.';
  END IF;

  PERFORM set_config('unisol.cancelamento_autorizado', 'on', true);

  UPDATE public.atividades
  SET
    status = 'CANCELADA',
    cancelada_por = auth.uid(),
    cancelada_em = now(),
    motivo_cancelamento = motivo
  WHERE id = atividade.id;

  PERFORM public.registrar_auditoria(
    auth.uid(),
    atividade.id,
    'ATIVIDADE',
    atividade.id,
    'CANCELOU_ATIVIDADE',
    jsonb_build_object(
      'status_anterior', atividade.status,
      'status_novo', 'CANCELADA',
      'motivo', motivo
    )
  );
END;
$$;

-- 6) Nome do administrador no cancelamento, sem enfraquecer RLS de profiles.

CREATE OR REPLACE FUNCTION public.informacoes_cancelamento(p_atividade_id UUID)
RETURNS TABLE (
  cancelada_por UUID,
  cancelada_em TIMESTAMPTZ,
  motivo_cancelamento TEXT,
  cancelada_por_nome TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  atividade public.atividades;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO atividade
  FROM public.atividades
  WHERE id = p_atividade_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF atividade.usuario_id IS DISTINCT FROM auth.uid()
     AND NOT public.eh_administrador() THEN
    RETURN;
  END IF;

  IF atividade.status IS DISTINCT FROM 'CANCELADA' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    atividade.cancelada_por,
    atividade.cancelada_em,
    atividade.motivo_cancelamento,
    COALESCE(
      (
        SELECT p.nome
        FROM public.profiles p
        WHERE p.id = atividade.cancelada_por
      ),
      'Administrador'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.cancelar_atividade(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.informacoes_cancelamento(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancelar_atividade(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.informacoes_cancelamento(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.solicitar_reabertura(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aprovar_reabertura(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pode_gerenciar_fotos_atividade(UUID) TO authenticated;
