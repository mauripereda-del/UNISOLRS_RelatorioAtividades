-- UNISOL RS — Relatório de Atividades
-- Script 010: administração de usuários.
-- Execute DEPOIS de 001, 002, 003, 004, 006, 006_1 e 007.
-- Idempotente. Não apaga usuários, atividades, fotos, auditoria nem Auth.

-- Decisões:
-- 1. Não há exclusão física de profiles. Inativação substitui exclusão.
-- 2. O último ADMIN ATIVO não pode ser inativado nem rebaixado (trigger).
-- 3. ADMIN autenticado não inativa nem rebaixa a si próprio (trigger).
-- 4. E-mail de profiles não muda pelo cliente; só pela Edge Function (service_role).
-- 5. Contagens de atividades em lote para evitar N+1.
-- 6. Atualização administrativa com checagem de updated_at e auditoria.

CREATE OR REPLACE FUNCTION public.existe_outro_admin_ativo(p_exceto UUID)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE perfil = 'ADMIN'
      AND status = 'ATIVO'
      AND id IS DISTINCT FROM p_exceto
  );
$$;

REVOKE ALL ON FUNCTION public.existe_outro_admin_ativo(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.existe_outro_admin_ativo(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.proteger_campos_sensiveis_profiles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.id := OLD.id;
  NEW.created_at := OLD.created_at;
  NEW.updated_at := now();

  IF OLD.perfil = 'ADMIN'
     AND OLD.status = 'ATIVO'
     AND (NEW.perfil IS DISTINCT FROM 'ADMIN' OR NEW.status IS DISTINCT FROM 'ATIVO')
     AND NOT public.existe_outro_admin_ativo(OLD.id)
  THEN
    RAISE EXCEPTION 'Não é permitido inativar ou rebaixar o último administrador ativo.';
  END IF;

  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF auth.uid() = OLD.id THEN
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'INATIVO' THEN
      RAISE EXCEPTION 'Você não pode inativar sua própria conta enquanto está utilizando o sistema.';
    END IF;

    IF OLD.perfil = 'ADMIN'
       AND NEW.perfil IS DISTINCT FROM OLD.perfil
       AND NEW.perfil = 'MOBILIZADOR'
    THEN
      RAISE EXCEPTION 'Você não pode alterar o próprio perfil de administrador enquanto está utilizando o sistema.';
    END IF;
  END IF;

  IF NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'O e-mail só pode ser alterado pela operação administrativa segura.';
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

CREATE OR REPLACE FUNCTION public.impedir_exclusao_profiles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Usuários não podem ser excluídos. Utilize a inativação para retirar o acesso.';
END;
$$;

DROP TRIGGER IF EXISTS trg_impedir_exclusao_profiles ON public.profiles;
CREATE TRIGGER trg_impedir_exclusao_profiles
  BEFORE DELETE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.impedir_exclusao_profiles();

CREATE INDEX IF NOT EXISTS idx_auditoria_entidade_id
  ON public.auditoria (entidade, entidade_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.contagens_atividades_usuarios(p_ids UUID[])
RETURNS TABLE (
  usuario_id UUID,
  total BIGINT,
  rascunhos BIGINT,
  concluidas BIGINT,
  canceladas BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.eh_administrador() THEN
    RAISE EXCEPTION 'Somente administrador ativo pode consultar estas estatísticas.';
  END IF;

  RETURN QUERY
  SELECT
    alvo.id,
    COUNT(a.id),
    COUNT(a.id) FILTER (WHERE a.status = 'RASCUNHO'),
    COUNT(a.id) FILTER (WHERE a.status = 'CONCLUIDA'),
    COUNT(a.id) FILTER (WHERE a.status = 'CANCELADA')
  FROM unnest(COALESCE(p_ids, ARRAY[]::UUID[])) AS alvo(id)
  LEFT JOIN public.atividades a ON a.usuario_id = alvo.id
  GROUP BY alvo.id;
END;
$$;

REVOKE ALL ON FUNCTION public.contagens_atividades_usuarios(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contagens_atividades_usuarios(UUID[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.atualizar_usuario_admin(
  p_id UUID,
  p_nome TEXT,
  p_telefone TEXT,
  p_perfil TEXT,
  p_status TEXT,
  p_updated_at TIMESTAMPTZ
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  atual public.profiles;
  atualizado public.profiles;
  nome_limpo TEXT;
  telefone_limpo TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.eh_administrador() THEN
    RAISE EXCEPTION 'Somente administrador ativo pode alterar usuários.';
  END IF;

  IF p_id IS NULL THEN
    RAISE EXCEPTION 'Usuário inválido.';
  END IF;

  nome_limpo := trim(COALESCE(p_nome, ''));
  IF char_length(nome_limpo) < 3 OR char_length(nome_limpo) > 150 THEN
    RAISE EXCEPTION 'O nome deve possuir entre 3 e 150 caracteres.';
  END IF;

  telefone_limpo := nullif(trim(COALESCE(p_telefone, '')), '');

  IF p_perfil IS DISTINCT FROM 'ADMIN' AND p_perfil IS DISTINCT FROM 'MOBILIZADOR' THEN
    RAISE EXCEPTION 'Perfil inválido.';
  END IF;

  IF p_status IS DISTINCT FROM 'ATIVO' AND p_status IS DISTINCT FROM 'INATIVO' THEN
    RAISE EXCEPTION 'Status inválido.';
  END IF;

  SELECT * INTO atual
  FROM public.profiles
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário não encontrado.';
  END IF;

  IF p_updated_at IS NULL OR atual.updated_at IS DISTINCT FROM p_updated_at THEN
    RAISE EXCEPTION 'Este usuário foi alterado por outro administrador. Atualize os dados antes de continuar.';
  END IF;

  UPDATE public.profiles
  SET
    nome = nome_limpo,
    telefone = telefone_limpo,
    perfil = p_perfil,
    status = p_status
  WHERE id = p_id
  RETURNING * INTO atualizado;

  IF atual.nome IS DISTINCT FROM atualizado.nome
     OR atual.telefone IS DISTINCT FROM atualizado.telefone
  THEN
    PERFORM public.registrar_auditoria(
      auth.uid(),
      NULL,
      'USUARIO',
      atualizado.id,
      'USUARIO_EDITADO',
      jsonb_strip_nulls(
        jsonb_build_object(
          'campos_alterados', (
            SELECT COALESCE(jsonb_agg(campo), '[]'::jsonb)
            FROM (
              SELECT 'nome' AS campo WHERE atual.nome IS DISTINCT FROM atualizado.nome
              UNION ALL
              SELECT 'telefone' WHERE atual.telefone IS DISTINCT FROM atualizado.telefone
            ) campos
          )
        )
      )
    );
  END IF;

  IF atual.perfil IS DISTINCT FROM atualizado.perfil THEN
    PERFORM public.registrar_auditoria(
      auth.uid(),
      NULL,
      'USUARIO',
      atualizado.id,
      'PERFIL_ALTERADO',
      jsonb_build_object(
        'perfil_anterior', atual.perfil,
        'perfil_novo', atualizado.perfil
      )
    );
  END IF;

  IF atual.status IS DISTINCT FROM atualizado.status THEN
    PERFORM public.registrar_auditoria(
      auth.uid(),
      NULL,
      'USUARIO',
      atualizado.id,
      CASE
        WHEN atualizado.status = 'ATIVO' THEN 'USUARIO_ATIVADO'
        ELSE 'USUARIO_INATIVADO'
      END,
      jsonb_build_object(
        'status_anterior', atual.status,
        'status_novo', atualizado.status
      )
    );
  END IF;

  RETURN atualizado;
END;
$$;

REVOKE ALL ON FUNCTION public.atualizar_usuario_admin(UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.atualizar_usuario_admin(UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;

COMMENT ON FUNCTION public.atualizar_usuario_admin(UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) IS
  'Atualiza nome, telefone, perfil e status com proteção de último ADMIN, auto-alteração e concorrência.';

COMMENT ON FUNCTION public.contagens_atividades_usuarios(UUID[]) IS
  'Contagens de atividades em lote para a administração de usuários.';

-- Profiles novos nascem do trigger de auth.users ou da Edge Function (service_role).
-- O cliente autenticado não precisa mais inserir linhas em profiles.
REVOKE INSERT ON TABLE public.profiles FROM authenticated;

CREATE OR REPLACE FUNCTION public.impedir_profile_orfao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = NEW.id) THEN
    RAISE EXCEPTION 'O perfil deve corresponder a um usuário de autenticação.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_impedir_profile_orfao ON public.profiles;
CREATE TRIGGER trg_impedir_profile_orfao
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.impedir_profile_orfao();
