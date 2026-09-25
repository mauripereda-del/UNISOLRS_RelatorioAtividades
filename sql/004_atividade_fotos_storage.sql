-- UNISOL RS — Relatório de Atividades
-- Script 004: atividade_fotos + bucket privado atividade-fotos.
-- Execute DEPOIS de 001, 002 e 003.
-- Idempotente nas policies deste módulo. Não apaga profiles, atividades nem dados.

-- Decisões:
-- 1. FK ON DELETE RESTRICT: a atividade não some e as fotos não são apagadas em cascata.
-- 2. Funções SECURITY DEFINER consultam atividades sem recursão de RLS.
-- 3. Limite de 3 fotos: lock da linha em atividades + contagem (concorrência razoável).
-- 4. CONCLUIDA exige >= 1 foto no trigger proteger_atividades (recriado aqui).
-- 5. Bucket privado; Storage policies validam a atividade real, não só a pasta.
-- 6. DROP POLICY IF EXISTS só nas policies deste módulo (atividade_fotos_*
--    e atividade_fotos_storage_*). Não mexe em profiles.

CREATE TABLE IF NOT EXISTS public.atividade_fotos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  atividade_id UUID NOT NULL REFERENCES public.atividades (id) ON DELETE RESTRICT,
  storage_path TEXT NOT NULL,
  nome_arquivo TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  tamanho_bytes BIGINT NOT NULL,
  legenda TEXT,
  ordem SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT atividade_fotos_storage_path_unique UNIQUE (storage_path),
  CONSTRAINT atividade_fotos_mime_check CHECK (mime_type IN ('image/jpeg', 'image/png')),
  CONSTRAINT atividade_fotos_tamanho_check CHECK (tamanho_bytes > 0 AND tamanho_bytes <= 5242880),
  CONSTRAINT atividade_fotos_legenda_check CHECK (legenda IS NULL OR char_length(legenda) <= 200),
  CONSTRAINT atividade_fotos_ordem_check CHECK (ordem >= 1 AND ordem <= 3)
);

COMMENT ON TABLE public.atividade_fotos IS
  'Metadados das fotografias. O arquivo físico fica no bucket privado atividade-fotos.';
COMMENT ON COLUMN public.atividade_fotos.storage_path IS
  'Caminho real no Storage. Não gravar signed URL.';

ALTER TABLE public.atividade_fotos
  DROP CONSTRAINT IF EXISTS atividade_fotos_atividade_ordem_unique;
ALTER TABLE public.atividade_fotos
  ADD CONSTRAINT atividade_fotos_atividade_ordem_unique
  UNIQUE (atividade_id, ordem)
  DEFERRABLE INITIALLY IMMEDIATE;

CREATE INDEX IF NOT EXISTS idx_atividade_fotos_atividade_id ON public.atividade_fotos (atividade_id);
CREATE INDEX IF NOT EXISTS idx_atividade_fotos_ordem ON public.atividade_fotos (atividade_id, ordem);

CREATE OR REPLACE FUNCTION public.pode_ver_fotos_atividade(p_atividade_id UUID)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.eh_administrador()
    OR EXISTS (
      SELECT 1
      FROM public.atividades a
      WHERE a.id = p_atividade_id
        AND a.usuario_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.pode_gerenciar_fotos_atividade(p_atividade_id UUID)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.eh_administrador()
    OR EXISTS (
      SELECT 1
      FROM public.atividades a
      WHERE a.id = p_atividade_id
        AND a.usuario_id = auth.uid()
        AND a.status = 'RASCUNHO'
        AND public.eh_usuario_ativo()
    );
$$;

REVOKE ALL ON FUNCTION public.pode_ver_fotos_atividade(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pode_gerenciar_fotos_atividade(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pode_ver_fotos_atividade(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pode_gerenciar_fotos_atividade(UUID) TO authenticated;

-- Limite de 3: o BEFORE INSERT trava a linha da atividade (FOR UPDATE)
-- e só então conta os registros. Duas inserções simultâneas na mesma
-- atividade entram em fila; a segunda vê a primeira já gravada.
CREATE OR REPLACE FUNCTION public.proteger_atividade_fotos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  qtd INTEGER;
BEGIN
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
    -- TODO: Registrar alterações administrativas de fotografias na auditoria.
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

DROP TRIGGER IF EXISTS trg_proteger_atividade_fotos ON public.atividade_fotos;
CREATE TRIGGER trg_proteger_atividade_fotos
  BEFORE INSERT OR UPDATE ON public.atividade_fotos
  FOR EACH ROW
  EXECUTE FUNCTION public.proteger_atividade_fotos();

DROP TRIGGER IF EXISTS trg_impedir_remover_ultima_foto_concluida ON public.atividade_fotos;
CREATE TRIGGER trg_impedir_remover_ultima_foto_concluida
  BEFORE DELETE ON public.atividade_fotos
  FOR EACH ROW
  EXECUTE FUNCTION public.impedir_remover_ultima_foto_concluida();

CREATE OR REPLACE FUNCTION public.reorganizar_fotos(p_atividade_id UUID, p_ids UUID[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  i INTEGER;
BEGIN
  IF NOT public.pode_gerenciar_fotos_atividade(p_atividade_id) THEN
    RAISE EXCEPTION 'Você não possui permissão para alterar as fotografias desta atividade.';
  END IF;

  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  -- UNIQUE deferrable evita colisão 1↔2 sem usar ordem temporária > 3
  -- (o CHECK ordem <= 3 permaneceria violado com a estratégia ordem + 10).
  SET CONSTRAINTS atividade_fotos_atividade_ordem_unique DEFERRED;

  FOR i IN 1 .. array_length(p_ids, 1) LOOP
    UPDATE public.atividade_fotos
    SET ordem = i,
        updated_at = now()
    WHERE id = p_ids[i]
      AND atividade_id = p_atividade_id;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.reorganizar_fotos(UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reorganizar_fotos(UUID, UUID[]) TO authenticated;

-- Recria o trigger de atividades incluindo a exigência de fotografia na conclusão.
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

  IF NEW.status = 'CONCLUIDA'
     AND NOT EXISTS (
       SELECT 1 FROM public.atividade_fotos WHERE atividade_id = NEW.id
     )
  THEN
    RAISE EXCEPTION 'Adicione pelo menos uma fotografia antes de concluir a atividade.';
  END IF;

  -- TODO: registrar edição administrativa na auditoria.

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.exigir_foto_ao_inserir_concluida()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'CONCLUIDA'
     AND NOT EXISTS (
       SELECT 1 FROM public.atividade_fotos WHERE atividade_id = NEW.id
     )
  THEN
    RAISE EXCEPTION 'Adicione pelo menos uma fotografia antes de concluir a atividade.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_exigir_foto_ao_inserir_concluida ON public.atividades;
CREATE TRIGGER trg_exigir_foto_ao_inserir_concluida
  BEFORE INSERT ON public.atividades
  FOR EACH ROW
  EXECUTE FUNCTION public.exigir_foto_ao_inserir_concluida();

ALTER TABLE public.atividade_fotos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atividade_fotos FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS atividade_fotos_select ON public.atividade_fotos;
CREATE POLICY atividade_fotos_select
  ON public.atividade_fotos
  FOR SELECT
  TO authenticated
  USING (public.pode_ver_fotos_atividade(atividade_id));

DROP POLICY IF EXISTS atividade_fotos_insert ON public.atividade_fotos;
CREATE POLICY atividade_fotos_insert
  ON public.atividade_fotos
  FOR INSERT
  TO authenticated
  WITH CHECK (public.pode_gerenciar_fotos_atividade(atividade_id));

DROP POLICY IF EXISTS atividade_fotos_update ON public.atividade_fotos;
CREATE POLICY atividade_fotos_update
  ON public.atividade_fotos
  FOR UPDATE
  TO authenticated
  USING (public.pode_gerenciar_fotos_atividade(atividade_id))
  WITH CHECK (public.pode_gerenciar_fotos_atividade(atividade_id));

DROP POLICY IF EXISTS atividade_fotos_delete ON public.atividade_fotos;
CREATE POLICY atividade_fotos_delete
  ON public.atividade_fotos
  FOR DELETE
  TO authenticated
  USING (public.pode_gerenciar_fotos_atividade(atividade_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.atividade_fotos TO authenticated;

-- Storage: bucket privado com limite de 5 MB e MIME permitidos.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'atividade-fotos',
  'atividade-fotos',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.caminho_foto_valido(p_name TEXT, p_somente_rascunho BOOLEAN)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  partes TEXT[];
  p_usuario UUID;
  p_atividade UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  partes := string_to_array(p_name, '/');
  IF array_length(partes, 1) < 3 THEN
    RETURN false;
  END IF;

  BEGIN
    p_usuario := partes[1]::UUID;
    p_atividade := partes[2]::UUID;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;

  IF public.eh_administrador() THEN
    RETURN EXISTS (
      SELECT 1 FROM public.atividades a WHERE a.id = p_atividade
    );
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.atividades a
    WHERE a.id = p_atividade
      AND a.usuario_id = auth.uid()
      AND a.usuario_id = p_usuario
      AND public.eh_usuario_ativo()
      AND (NOT p_somente_rascunho OR a.status = 'RASCUNHO')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.caminho_foto_valido(TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caminho_foto_valido(TEXT, BOOLEAN) TO authenticated;

DROP POLICY IF EXISTS atividade_fotos_storage_select ON storage.objects;
CREATE POLICY atividade_fotos_storage_select
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'atividade-fotos'
    AND public.caminho_foto_valido(name, false)
  );

DROP POLICY IF EXISTS atividade_fotos_storage_insert ON storage.objects;
CREATE POLICY atividade_fotos_storage_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'atividade-fotos'
    AND public.caminho_foto_valido(name, true)
  );

DROP POLICY IF EXISTS atividade_fotos_storage_update ON storage.objects;
CREATE POLICY atividade_fotos_storage_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'atividade-fotos'
    AND public.caminho_foto_valido(name, true)
  )
  WITH CHECK (
    bucket_id = 'atividade-fotos'
    AND public.caminho_foto_valido(name, true)
  );

DROP POLICY IF EXISTS atividade_fotos_storage_delete ON storage.objects;
CREATE POLICY atividade_fotos_storage_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'atividade-fotos'
    AND public.caminho_foto_valido(name, true)
  );
