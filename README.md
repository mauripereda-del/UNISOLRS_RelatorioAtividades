# UNISOL RS — Relatório de Atividades

Sistema de relatórios de atividades da UNISOL RS: frontend HTML/CSS/JavaScript e Supabase.

**Estado atual:** o desenvolvimento funcional dos Prompts 01 a 10 está concluído. A auditoria técnica pré-produção (Prompt 11) foi executada. O **deploy ainda está pendente** (Vercel, Edge Function `admin-usuarios`, URLs de produção).

## Requisitos

- Navegador atualizado (Chrome, Edge, Firefox ou Safari)
- Ambiente local com Node.js 18+ (para `npm run dev`) **ou** Python 3
- Conta no [Supabase](https://supabase.com)
- Um projeto Supabase criado

Não abra os arquivos HTML diretamente pelo `file://`. Os módulos JavaScript precisam ser servidos por HTTP.

## Como as variáveis de ambiente funcionam

O frontend é HTML/CSS/JavaScript puro, sem bundler. O navegador **não lê** arquivos `.env`.

Por isso o projeto usa dois caminhos, com os mesmos nomes de variável:

| Variável | Uso | Segredo? |
| --- | --- | --- |
| `SUPABASE_URL` | URL pública do projeto | Não |
| `SUPABASE_ANON_KEY` | Chave pública `anon` | Não. Foi feita para o navegador |

**Nunca** coloque `SUPABASE_SERVICE_ROLE_KEY` no frontend, no `js/env.js` ou nas variáveis da Vercel destinadas ao browser. A `service_role` ignora RLS e daria acesso total ao banco.

A segurança dos dados depende de:

1. sessão do Supabase Auth;
2. usuário **ATIVO** em `profiles`;
3. políticas de **Row Level Security**.

A chave `anon` apenas identifica o projeto. Sozinha ela não autoriza leitura de dados protegidos.

### Desenvolvimento local

1. Copie `js/env.example.js` para `js/env.js`.
2. Preencha `SUPABASE_URL` e `SUPABASE_ANON_KEY`.
3. `js/env.js` está no `.gitignore` e não deve ser versionado.

O arquivo `.env.example` documenta os mesmos nomes para a Vercel e para o script de build.

### Deploy na Vercel

No build, `npm run build` executa `scripts/gerar-env.js`, que lê `SUPABASE_URL` e `SUPABASE_ANON_KEY` do ambiente da Vercel e gera `js/env.js`. As páginas carregam esse arquivo antes dos módulos.

## Configuração

### 1. Criar o projeto no Supabase

No painel do Supabase, crie um projeto (região mais próxima, senha forte do banco). Aguarde a inicialização.

### 2. Localizar a URL do projeto

Em **Project Settings → API**:

- **Project URL** → `SUPABASE_URL`  
  Exemplo: `https://abcdefgh.supabase.co`

### 3. Localizar a chave pública correta

No mesmo painel, copie a chave **anon** / **public**.

Não use a chave **service_role**.

### 4. Configurar o ambiente local

```powershell
copy js\env.example.js js\env.js
```

Edite `js/env.js`:

```js
window.__UNISOL_ENV__ = {
  SUPABASE_URL: "https://SEU_PROJETO.supabase.co",
  SUPABASE_ANON_KEY: "sua-chave-anon-publica",
};
```

### 5. Executar os scripts SQL

No Supabase, abra **SQL Editor** e execute nesta ordem:

1. conteúdo de `sql/001_initial_schema.sql`
2. conteúdo de `sql/002_rls_policies.sql`
3. conteúdo de `sql/003_atividades.sql`
4. conteúdo de `sql/004_atividade_fotos_storage.sql`
5. conteúdo de `sql/006_reabertura_auditoria.sql`
6. conteúdo de `sql/006_1_ajustes_reabertura.sql`
7. conteúdo de `sql/007_cancelamento_auditoria.sql`

Os scripts são idempotentes o suficiente para esta etapa (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP POLICY IF EXISTS`).

Eles **não** apagam dados. Não execute comandos destrutivos por conta própria.

O script `001` também cria um trigger em `auth.users`: todo usuário novo recebe automaticamente um registro em `profiles` como `MOBILIZADOR` e `INATIVO`. Assim, mesmo que a conta exista no Auth, ela não acessa o sistema até um administrador ativá-la.

Se o trigger em `auth.users` for recusado pelo projeto, crie o registro em `profiles` manualmente, como no passo 7.

### 6. Criar o primeiro usuário no Auth

Não existe formulário público de cadastro.

1. Abra **Authentication → Users → Add user**.
2. Informe e-mail e senha.
3. Marque a opção de confirmar o e-mail automaticamente (**Auto Confirm User**), para o primeiro administrador não ficar bloqueado por confirmação.
4. Copie o **UUID** do usuário criado.

Recomendação de segurança: em **Authentication → Providers → Email**, desative o cadastro público (*Allow new users to sign up*), para ninguém criar conta pela API de signup.

### 7. Criar ou promover o primeiro profile ADMIN

Depois do passo 6, o trigger provavelmente já criou o profile como `MOBILIZADOR` / `INATIVO`. Promova-o no SQL Editor:

```sql
UPDATE public.profiles
SET
  nome = 'Nome do Administrador',
  email = 'admin@exemplo.com',
  telefone = NULL,
  perfil = 'ADMIN',
  status = 'ATIVO'
WHERE id = 'COLE-AQUI-O-UUID-DO-AUTH';
```

Se o registro ainda não existir:

```sql
INSERT INTO public.profiles (id, nome, email, perfil, status)
VALUES (
  'COLE-AQUI-O-UUID-DO-AUTH',
  'Nome do Administrador',
  'admin@exemplo.com',
  'ADMIN',
  'ATIVO'
)
ON CONFLICT (id) DO UPDATE
SET
  nome = EXCLUDED.nome,
  email = EXCLUDED.email,
  perfil = 'ADMIN',
  status = 'ATIVO';
```

Para um mobilizador de teste, crie outro usuário no Auth e depois:

```sql
UPDATE public.profiles
SET
  nome = 'Nome do Mobilizador',
  email = 'mobilizador@exemplo.com',
  perfil = 'MOBILIZADOR',
  status = 'ATIVO'
WHERE id = 'UUID-DO-MOBILIZADOR';
```

Para testar usuário inativo, use `status = 'INATIVO'`.

### 8. Configurar URLs de recuperação de senha

Em **Authentication → URL Configuration**:

**Desenvolvimento local**

- Site URL: `http://localhost:5500`
- Redirect URLs:
  - `http://localhost:5500/**`
  - `http://localhost:5500/pages/redefinir-senha.html`

**Produção na Vercel** (depois do deploy)

- Site URL: `https://seu-dominio.vercel.app`
- Redirect URLs adicionais:
  - `https://seu-dominio.vercel.app/**`
  - `https://seu-dominio.vercel.app/pages/redefinir-senha.html`

O aplicativo envia `redirectTo` apontando para `/pages/redefinir-senha.html` no mesmo origin em que o usuário está.

Se o e-mail de recuperação não chegar, verifique **Authentication → Emails** e a caixa de spam. No plano gratuito o remetente padrão do Supabase tem limite de disparos.

### 9. Iniciar a aplicação localmente

Na pasta do projeto:

```powershell
npm run dev
```

A aplicação fica em `http://localhost:5500`.

Alternativa sem Node:

```powershell
python -m http.server 5500
```

### 10. Testar o login

Abra `http://localhost:5500/index.html` e entre com o ADMIN criado no passo 7.

### 11. Testar o logout

No dashboard, use **Sair**. A sessão do Supabase é encerrada e a aplicação volta para o login.

### 12. Testar a recuperação de senha

1. Em `http://localhost:5500/pages/recuperar-senha.html`, informe o e-mail.
2. Abra o e-mail enviado pelo Supabase.
3. O link deve abrir `http://localhost:5500/pages/redefinir-senha.html`.
4. Defina a nova senha e confirme.
5. A aplicação encerra a sessão de recuperação e devolve ao login.

## Prompt 03 — Cadastro de atividades

Execute no SQL Editor do Supabase, **depois** dos scripts 001 e 002:

`sql/003_atividades.sql`

O script cria a tabela `public.atividades` e não altera `profiles` nem as policies já existentes.

### Tabela

- `id` UUID gerado por `gen_random_uuid()`
- `usuario_id` referencia `auth.users(id)` com `ON DELETE RESTRICT` (o histórico não some se alguém tentar apagar o usuário)
- `data_atividade` DATE obrigatória
- `introducao`, `descricao`, `conclusao` TEXT
- `status` com CHECK: `RASCUNHO`, `CONCLUIDA`, `CANCELADA` (padrão `RASCUNHO`)
- `created_at` e `updated_at` preenchidos pelo banco

### Rascunho × conclusão

- **Salvar Rascunho:** não exige 300/500/500 caracteres. Basta data e o usuário da sessão.
- **Concluir Atividade:** introdução ≥ 300, descrição ≥ 500 e conclusão ≥ 500, no frontend **e** no banco (constraint `atividades_concluida_textos_check`).
- `CANCELADA` é estado final administrativo (Prompt 07). Somente ADMIN ATIVO cancela, com motivo de 50 a 1000 caracteres. Não há descancelamento.

### Permissões

- **MOBILIZADOR ATIVO:** cria e edita somente as próprias atividades em `RASCUNHO`. Pode concluir (`RASCUNHO` → `CONCLUIDA`). Não edita `CONCLUIDA`/`CANCELADA`, não muda `usuario_id` e não marca `CANCELADA`.
- **ADMIN ATIVO:** consulta e edita qualquer atividade, inclusive `CONCLUIDA`. A edição administrativa **não** altera o status automaticamente. Alterações administrativas e cancelamentos são auditados.

A segurança real está no RLS + trigger `proteger_atividades()`. O frontend só organiza a interface.

### Fotografias

O registro fotográfico foi implementado no Prompt 04. Veja a seção abaixo.

## Prompt 04 — Registro Fotográfico

Execute no SQL Editor do Supabase, **depois** dos scripts 001, 002 e 003:

`sql/004_atividade_fotos_storage.sql`

O script é reexecutável nas policies deste módulo (`DROP POLICY IF EXISTS` apenas em `atividade_fotos` e nas policies de Storage com prefixo `atividade_fotos_storage_*`). Ele **não** apaga dados, **não** desabilita RLS e **não** altera as policies de `profiles`.

### Tabela `atividade_fotos`

Metadados das fotografias. O arquivo físico **não** fica no PostgreSQL.

- `atividade_id` referencia `atividades(id)` com `ON DELETE RESTRICT` (atividades não são excluídas fisicamente; as fotos não somem em cascata)
- `storage_path` é o caminho real no bucket (único). **Não** grave signed URL no banco
- `nome_arquivo` guarda o nome original sanitizado
- `mime_type` somente `image/jpeg` ou `image/png`
- `tamanho_bytes` até 5 MB
- `legenda` opcional, até 200 caracteres
- `ordem` 1, 2 ou 3, única por atividade

### Bucket `atividade-fotos`

Bucket **privado**. O script cria/atualiza:

- `public = false`
- limite de 5 MB por arquivo
- MIME permitidos: `image/jpeg` e `image/png`

Caminho dos arquivos:

`{usuario_id}/{atividade_id}/{uuid}.jpg|png`

O primeiro segmento é o responsável da atividade (não o administrador que eventualmente envia o arquivo).

### Regras de quantidade

- Rascunho: 0 a 3 fotografias
- Conclusão: mínimo 1, máximo 3
- O banco impede a 4ª foto com trigger: trava a linha em `atividades` (`FOR UPDATE`) e conta os registros
- `proteger_atividades()` impede `RASCUNHO` → `CONCLUIDA` sem pelo menos uma foto, além dos mínimos 300/500/500

### Permissões

- **MOBILIZADOR ATIVO:** vê e gerencia fotos somente das próprias atividades em `RASCUNHO`. Em `CONCLUIDA`, só visualiza
- **ADMIN ATIVO:** visualiza qualquer foto e pode adicionar/remover/substituir conforme a permissão administrativa de edição
- Visualização usa **signed URL** de curta duração gerada na hora. A URL não é persistida
- Policies de Storage validam a atividade real em `atividades`, não apenas a pasta `{usuario_id}`

### Frontend

Em **Nova Atividade**, o bloco Registro Fotográfico permite adicionar, pré-visualizar, legendas, remover e reordenar (mover para cima/baixo). Ao enviar a primeira foto de uma atividade ainda sem ID, o sistema cria automaticamente o rascunho, atualiza a URL com `?id=` e só então faz o upload.

### Configuração manual no Supabase

Na maior parte dos projetos, executar o script 004 basta: ele cria a tabela, as funções, o bucket e as policies.

Confira depois em **Storage**:

1. o bucket `atividade-fotos` existe
2. ele está **privado** (não público)
3. o limite de tamanho é 5 MB
4. os MIME permitidos são `image/jpeg` e `image/png`

Não é necessário tornar o bucket público nem cadastrar `service_role` no frontend.

## Prompt 05 — Histórico de Atividades

Não é necessário executar SQL adicional. Os índices de `sql/003_atividades.sql` (`usuario_id`, `data_atividade`, `status`, `updated_at`) já atendem às consultas do Histórico. Nenhuma policy de RLS foi alterada.

### Páginas

- `pages/historico.html` — listagem com filtros, busca, ordenação e paginação
- `pages/visualizar-atividade.html?id=UUID` — leitura completa da atividade e das fotografias

O menu **Histórico de Atividades** e o atalho do Dashboard passam a apontar para a página real.

### Filtros

Aplicados na consulta ao Supabase, não no navegador:

- Data inicial e final sobre `data_atividade` (não `created_at`)
- Status: Todos, Rascunho, Concluída, Cancelada
- Busca textual em `introducao`, `descricao` e `conclusao` com `ilike` parametrizado
- Ordenação: mais recentes (`data_atividade DESC`), mais antigas ou atualizadas recentemente
- **ADMIN:** Mobilizador (nome, UUID interno) e Perfil do responsável
- **MOBILIZADOR:** apenas as próprias atividades (RLS + escopo no frontend). Parâmetros `mobilizador`/`perfil` na URL são ignorados

Se a data inicial for posterior à final, a consulta não é enviada.

### Paginação e URL

10 registros por página, com `count` do resultado filtrado. Os filtros úteis ficam na query string (`inicio`, `fim`, `status`, `mobilizador`, `perfil`, `busca`, `pagina`, `ordenacao`) para atualizar, voltar no navegador e retornar do detalhe sem perder o contexto.

### Visualização

O detalhe mostra textos completos com `textContent` (quebras de linha preservadas) e fotografias via `atividade-fotos.js` + signed URLs, na ordem salva. Clique amplia em um `<dialog>` acessível (Fechar e ESC).

### Permissões

- **Visualizar** para qualquer atividade que o usuário já possa consultar
- **Editar** no rascunho próprio do mobilizador e, para o ADMIN, conforme a permissão administrativa já existente
- Sem Cancelar ou Excluir nesta etapa. Reabertura está no Prompt 06.

## Prompt 06 — Reabertura e Auditoria

Execute no SQL Editor do Supabase, **depois** de 001, 002, 003 e 004:

`sql/006_reabertura_auditoria.sql`

Não há configuração manual extra no Storage. O bucket continua privado.

### Tabelas

- `solicitacoes_reabertura`: PENDENTE, APROVADA, RECUSADA. Motivo 20–1000 caracteres. Uma PENDENTE por atividade (índice UNIQUE parcial). Recusa exige observação ≥ 10.
- `auditoria`: imutável. Sem INSERT/UPDATE/DELETE pelo cliente. Data/hora com `now()` no banco.

### Fluxo

1. MOBILIZADOR ATIVO solicita reabertura da própria atividade `CONCLUIDA` (RPC `solicitar_reabertura`). A atividade permanece concluída.
2. ADMIN analisa em `pages/solicitacoes-reabertura.html`.
3. `aprovar_reabertura` (transacional): valida ADMIN e PENDENTE, marca APROVADA, altera `CONCLUIDA` → `RASCUNHO` e registra auditoria. Textos e fotos são preservados.
4. `recusar_reabertura`: marca RECUSADA; a atividade continua `CONCLUIDA`.

A transição `CONCLUIDA` → `RASCUNHO` **não** pode ser feita por `UPDATE` direto. `proteger_atividades()` só autoriza essa mudança quando a RPC define `unisol.reabertura_autorizada`. Mobilizador continua impedido pela policy e pelo trigger.

### Auditoria administrativa

Triggers registram `EDICAO_ADMINISTRATIVA` e eventos de foto quando o ADMIN altera atividade/foto de outro usuário. Não grava signed URL nem textos completos — apenas campos alterados, ids e nomes de arquivo.

### Permissões

- MOBILIZADOR vê o histórico de reaberturas da própria atividade. Não acessa o painel admin (guard + RLS).
- ADMIN vê todas as solicitações, a auditoria completa da atividade e o contador de pendentes no Dashboard.
- Nomes vêm de `profiles`, não de UUID na interface.

### Concorrência

Duas solicitações PENDENTE na mesma atividade: a segunda falha. Dois ADMINs analisando a mesma: `SELECT FOR UPDATE`; a segunda recebe “já foi analisada”.

## Prompt 06.1 — Ajustes de Reabertura

Execute depois do 006:

`sql/006_1_ajustes_reabertura.sql`

### Motivo mínimo

Novas solicitações exigem **50 caracteres** (frontend + RPC). O máximo continua 1000. Solicitações antigas com 20–49 caracteres **não são apagadas nem alteradas**. A constraint da tabela permanece ≥ 20 para não invalidar o histórico.

### Status real × situação operacional

`atividades.status` continua apenas `RASCUNHO`, `CONCLUIDA` e `CANCELADA`.

A interface calcula um **status exibido** com `obterStatusExibido()`:

- CONCLUIDA + PENDENTE → Reabertura Solicitada
- APROVADA + RASCUNHO → Reabertura Aprovada
- CONCLUIDA + RECUSADA (última) → Reabertura Recusada
- Após nova conclusão, sem PENDENTE → Concluída

Filtros do Histórico por Status continuam no status real do banco.

O filtro separado **Situação** (Sem reabertura / Solicitada / Aprovada / Recusada) **não foi implementado** neste ajuste, para não alterar a consulta do Histórico. O badge operacional já aparece na listagem.

### Badges

Rascunho, Concluída, Cancelada, Reabertura Solicitada, Reabertura Aprovada e Reabertura Recusada. O texto identifica a situação; a cor é apenas apoio visual.

### Dashboard

- Atividades Recentes: sem coluna Responsável; mostra Situação operacional
- ADMIN: contador de reaberturas pendentes (abre o painel já filtrado em PENDENTE)
- MOBILIZADOR: card Reaberturas e seção Atualizações de Reabertura (pendente / aprovada / recusada), com data/hora da análise quando houver
- Alertas derivados de `solicitacoes_reabertura`; sem tabela de notificações

## Prompt 07 — Cancelamento Administrativo

Execute depois do 006.1:

`sql/007_cancelamento_auditoria.sql`

Não publique na Vercel nesta etapa.

### Quem cancela

Somente **ADMIN ATIVO**, via RPC `cancelar_atividade`. MOBILIZADOR não cancela (frontend + banco). Não existe UPDATE direto para `CANCELADA`.

### Estados permitidos

Pode cancelar `RASCUNHO` ou `CONCLUIDA`. Não cancela `CANCELADA` de novo. Se existir reabertura `PENDENTE`, o cancelamento é bloqueado até a análise. Solicitações `APROVADA`/`RECUSADA` antigas não impedem.

### Motivo

Obrigatório, **50 a 1000** caracteres, no frontend, na RPC e no banco.

### Campos na atividade

`cancelada_por`, `cancelada_em`, `motivo_cancelamento`. Representam o estado atual. A auditoria (`CANCELOU_ATIVIDADE`) é o histórico imutável.

### Estado final

`CANCELADA` preserva textos, fotos, histórico e auditoria. Ninguém edita conteúdo, altera fotos, conclui, reabre ou desfaz o cancelamento neste Prompt.

### Auditoria

Eventos administrativos com rótulos amigáveis na tela. Leituras (Dashboard, Histórico, signed URL) não são auditadas. Sem UPDATE/DELETE em `auditoria`.

## Prompt 08 — Relatório Individual em Word

Não há SQL neste Prompt. Não altere RLS nem o Storage. O `.docx` é gerado no navegador e baixado; não é gravado no Supabase.

### Biblioteca

`docx` **9.7.2**, registrada em `package.json`. O frontend continua sem bundler. O pacote já publica um ESM autocontido (`dist/index.mjs`), copiado para `js/vendor/docx.mjs` via `npm run vendor:docx`. Assim o navegador importa localmente, sem CDN.

`npm run build` continua gerando apenas `js/env.js`.

### Quem gera

Quem já pode visualizar a atividade (RLS). Botão **Gerar Relatório Word** em `visualizar-atividade.html`.

### Estrutura A4 retrato

Cabeçalho com `assets/images/logounisol.png` + UNISOL RS / Relatório de Atividades; título; identificação; introdução; atividade realizada; fotografias; conclusão; informações do registro; cancelamento ou situação administrativa quando couber; rodapé com página.

### Status

RASCUNHO, CONCLUIDA e CANCELADA. Rascunho e reabertura aprovada exibem **RASCUNHO — DOCUMENTO NÃO FINALIZADO**. Cancelada inclui motivo, data e administrador.

### Fotografias

Signed URLs novas a cada geração. Proporção preservada. Se uma foto (ou o logo) falhar, o relatório não é gerado.

### Nome do arquivo

`Relatorio_Atividade_YYYY-MM-DD_NomeMobilizador_HHMM.docx` — o horário vem de `created_at` para evitar colisão no mesmo dia.

## Prompt 09 — Relatório Mensal em Word

Página: `pages/relatorio-mensal.html` (`js/relatorio-mensal.js`, `css/relatorio-mensal.css`). Sem SQL novo (`sql/009_*` não existe), sem alteração de RLS e sem Storage para DOCX. Geração no navegador, reutilizando a infraestrutura Word do Prompt 08 (`js/relatorio-word.js` + `docx` 9.7.2 vendorizado).

### Permissões

- MOBILIZADOR gera somente o próprio relatório. Qualquer `mobilizador` na URL ou no DOM é ignorado; o frontend força `usuario_id` do autenticado. RLS continua sendo a barreira real.
- ADMIN escolhe o mobilizador (nome, nunca UUID), o mês e o ano. Mobilizadores INATIVOS com histórico permanecem no seletor como `Nome — Inativo`.

### Período

Usa `data_atividade` (DATE, sem conversão UTC que mude o dia) em intervalo semiaberto: `>= YYYY-MM-01` e `<` primeiro dia do mês seguinte. Mês e ano atuais vêm pré-selecionados.

### Atividades incluídas

Entram apenas atividades com status real `CONCLUIDA`, inclusive com situação operacional Reabertura Solicitada ou Reabertura Recusada.

### Atividades excluídas

`RASCUNHO` (inclui reabertura aprovada em correção) e `CANCELADA` não entram no Word. A prévia informa as quantidades. Motivos de cancelamento e auditoria técnica ficam no histórico / relatório individual.

### Capa, resumo e atividades

Capa institucional (logo `assets/images/logounisol.png`, UNISOL RS, título, mobilizador, período por extenso, quantidade exata). Quebra de página. Resumo em tabela Nº / Data / Atividade. Em seguida, **ATIVIDADES REALIZADAS**, uma por bloco (`ATIVIDADE 01`…), com introdução, descrição, fotografias, legendas e conclusão. Cada nova atividade começa em nova página.

### Fotografias e signed URLs

Regras do Prompt 08: proporção, A4, JPG/JPEG/PNG, legenda associada, `ordem ASC`. Signed URLs novas somente na geração (e ao visualizar o detalhe). A prévia mostra só a quantidade de fotos. Bucket `atividade-fotos` permanece privado. URL e Base64 não são persistidos.

### Geração no navegador

`gerarRelatorioMensalWord()` monta o DOCX no cliente. Fotos processadas por atividade, com concorrência limitada (4). Barra de progresso com `aria-live`. Falha de logo, foto ou atividade concluída sem foto interrompe a geração.

### Nome do arquivo

`Relatorio_Mensal_YYYY_MM_NomeMobilizador.docx` — nome sanitizado, sem UUID.

### Performance

Não usa `Promise.all()` ilimitado em dezenas de imagens. Relatórios grandes podem falhar de forma controlada; o documento não é baixado corrompido.

## Prompt 10 — Administração de Usuários

Somente **ADMIN ATIVO** acessa `pages/usuarios.html`. Esconder o menu não é segurança: o guard redireciona MOBILIZADOR/INATIVO/anônimo e a Edge Function recusa JWT inválido (401) ou não administrador (403).

Não há exclusão física. Inativação retira o acesso e preserva histórico, atividades, fotos, auditoria e relatórios.

### Criação segura e Edge Function

A criação de `auth.users` **não** usa `auth.admin.createUser()` no navegador. O frontend chama `supabase/functions/admin-usuarios` com o JWT da sessão. Ações permitidas (allowlist): `CRIAR_USUARIO`, `ALTERAR_EMAIL`, `ENVIAR_RECUPERACAO`.

`SUPABASE_SERVICE_ROLE_KEY` existe **somente** no ambiente da Edge Function. Não entra em `js/env.js`, HTML, `localStorage`, `package.json` nem nas variáveis da Vercel destinadas ao browser.

O trigger `criar_profile_novo_usuario` continua criando `MOBILIZADOR/INATIVO`. A função administrativa atualiza o profile para o perfil/status escolhidos. Se Auth nascer e o profile falhar, a função devolve erro claro e não apaga a conta.

### Listagem, filtros e Meu Perfil

Listagem paginada (10), busca por nome/e-mail, filtros de perfil e status, ordenação e contagem de atividades em lote (`contagens_atividades_usuarios`). UUID não é exibido.

`pages/meu-perfil.html` permite a qualquer usuário ATIVO alterar nome e telefone. E-mail, perfil e status são somente leitura. Senha usa o fluxo existente de recuperação (`redefinir-senha.html`).

### Proteções

- ADMIN não inativa nem rebaixa a si próprio.
- O último ADMIN ATIVO não pode ser inativado nem rebaixado (trigger + RPC).
- E-mail só muda pela Edge Function, mantendo Auth e `profiles` iguais.
- `sql/010_administracao_usuarios.sql` adiciona essas proteções, a RPC de edição com `updated_at` e a agregação de atividades. Não apaga dados.

### Auditoria

Eventos em `auditoria` existente: `USUARIO_CRIADO`, `USUARIO_EDITADO`, `USUARIO_ATIVADO`, `USUARIO_INATIVADO`, `PERFIL_ALTERADO`, `EMAIL_ALTERADO`, `RECUPERACAO_SENHA_SOLICITADA`. Sem senha, token, link ou service_role.

### Deploy da Edge Function (manual)

Não execute o deploy automaticamente sem autorização.

1. Instale e autentique a [Supabase CLI](https://supabase.com/docs/guides/cli).
2. `supabase link --project-ref SEU_PROJECT_REF`
3. Confirme que `SUPABASE_SERVICE_ROLE_KEY` já existe como secret do projeto (o ambiente hospedado injeta essa chave automaticamente). **Não** copie essa chave para o frontend.
4. Execute no SQL Editor o script `sql/010_administracao_usuarios.sql`.
5. `supabase functions deploy admin-usuarios`
6. Em Authentication → URL Configuration, autorize `http://localhost:PORTA/pages/redefinir-senha.html` e, no futuro, a URL da Vercel.
7. Configure SMTP/e-mail do projeto para convite e recuperação funcionarem.

#### Secrets exclusivos do backend / Edge Function

`SUPABASE_SERVICE_ROLE_KEY` é secret de servidor. **Nunca** adicione essa chave ao `.env.example` do frontend, ao `js/env.js` ou às Environment Variables da Vercel usadas pelo browser.

Testes locais da função: `supabase functions serve admin-usuarios` com secrets no ambiente da CLI, separados do `js/env.js`.

### Limitação de sessão

Inativar um usuário bloqueia a próxima validação de página (`status = ATIVO`). Este Prompt não revoga instantaneamente todos os refresh tokens abertos.

## Vercel

1. Publique este repositório na Vercel (framework: **Other**).
2. Em **Settings → Environment Variables**, cadastre:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
3. O `vercel.json` já define `npm run build`, que gera `js/env.js` no deploy.
4. Atualize as Redirect URLs do Supabase com o domínio da Vercel.
5. **Não cadastre `SUPABASE_SERVICE_ROLE_KEY` nas variáveis da Vercel do frontend.** A Edge Function usa o secret do ambiente Supabase.
6. Headers atuais: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` e `Permissions-Policy` conservadora (camera, microphone, geolocation, payment).
7. Content-Security-Policy **não** foi adicionada: a aplicação usa módulos JS, CDN do Supabase client, signed URLs, Blob/download Word e origem variável. Uma CSP rígida sem teste no domínio final pode quebrar o deploy. Avaliar CSP na etapa de produção, com os domínios reais.

Antes do deploy, execute localmente:

```powershell
npm run predeploy-check
npm run build
```

## Segurança de `profiles` e RLS

- MOBILIZADOR consulta apenas o próprio perfil.
- MOBILIZADOR altera somente nome e telefone no **Meu Perfil**. Não altera `perfil`, `status` nem e-mail (trigger no banco).
- ADMIN ativo consulta e atualiza perfis pela administração de usuários. E-mail, criação Auth e recuperação passam pela Edge Function.
- A verificação de ADMIN **não** é feita com um `SELECT` direto em `profiles` dentro da policy, para evitar recursão de RLS. Usamos a função `public.eh_administrador()`, `SECURITY DEFINER`, documentada em `sql/002_rls_policies.sql`.
- Esconder o menu **Usuários** no frontend não é autorização. A autorização real está no banco.

## Estrutura

```
.
├── index.html
├── pages/
│   ├── dashboard.html
│   ├── nova-atividade.html
│   ├── historico.html
│   ├── visualizar-atividade.html
│   ├── solicitacoes-reabertura.html
│   ├── relatorio-mensal.html
│   ├── usuarios.html
│   ├── visualizar-usuario.html
│   ├── meu-perfil.html
│   ├── recuperar-senha.html
│   └── redefinir-senha.html
├── css/         (inclui usuarios.css)
├── js/          (inclui admin-usuarios.js, usuarios.js, meu-perfil.js)
├── supabase/functions/admin-usuarios/
├── assets/images/
├── sql/
├── scripts/gerar-env.js
├── .env.example
├── vercel.json
└── README.md
```

Os arquivos foram colocados na raiz do repositório (e não em uma subpasta `unisol-rs-relatorios`) para o deploy na Vercel funcionar sem configuração extra de diretório.

A marca institucional usada na interface e no Word é `assets/images/logounisol.png`.

## Ordem dos scripts SQL

Execute no SQL Editor, nesta ordem, sem inventar arquivos ausentes:

1. `sql/001_initial_schema.sql`
2. `sql/002_rls_policies.sql`
3. `sql/003_atividades.sql`
4. `sql/004_atividade_fotos_storage.sql`
5. `sql/006_reabertura_auditoria.sql`
6. `sql/006_1_ajustes_reabertura.sql`
7. `sql/007_cancelamento_auditoria.sql`
8. `sql/010_administracao_usuarios.sql`

Não existem `005`, `008` nem `009`. Não há sistema de migrations automático; a recomendação futura é versionar esses scripts com a CLI do Supabase, sem reescrever o que já foi aplicado.

## Pendências para Deploy

Estas tarefas **não** foram executadas no Prompt 11 e pertencem à etapa de publicação:

1. Autenticar a Supabase CLI.
2. Executar `supabase link` no projeto.
3. Confirmar que `sql/010_administracao_usuarios.sql` foi aplicado no banco.
4. Publicar a Edge Function `admin-usuarios`.
5. Testar a função hospedada (criar usuário, alterar e-mail, recuperação administrativa, 401/403).
6. Configurar SMTP do Supabase, se o envio de e-mail ainda não funcionar.
7. Criar o projeto na Vercel / importar o repositório (framework **Other**).
8. Cadastrar `SUPABASE_URL` nas Environment Variables da Vercel.
9. Cadastrar `SUPABASE_ANON_KEY` nas Environment Variables da Vercel.
10. Publicar o frontend (`vercel --prod` ou deploy Git). **Não** adicionar `SUPABASE_SERVICE_ROLE_KEY` na Vercel.
11. Atualizar Site URL no Supabase.
12. Atualizar Redirect URLs (`/pages/redefinir-senha.html` no domínio de produção).
13. Executar smoke tests de produção.

## O que vem depois

A próxima etapa é o deploy (Prompt de publicação), não novos módulos de negócio.
