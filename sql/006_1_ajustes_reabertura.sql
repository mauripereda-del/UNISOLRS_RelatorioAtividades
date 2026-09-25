-- UNISOL RS — Relatório de Atividades
-- Script 006.1: motivo mínimo 50 em NOVAS solicitações.
-- Execute DEPOIS de sql/006_reabertura_auditoria.sql.
-- Incremental. Não apaga dados, tabelas, fotos nem solicitações existentes.

-- A constraint da tabela permanece >= 20 para não invalidar
-- solicitações históricas com motivo entre 20 e 49 caracteres.
-- A RPC solicitar_reabertura passa a exigir 50 caracteres.

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
