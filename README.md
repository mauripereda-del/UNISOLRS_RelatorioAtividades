# UNISOL RS — Relatório de Atividades

Fundação técnica do sistema de relatórios de atividades da UNISOL RS: estrutura do frontend, conexão com Supabase, autenticação, perfis, recuperação de senha e proteção de páginas.

Esta etapa **não** inclui cadastro de atividades, upload de fotografias, histórico, geração de Word, relatório mensal, reabertura nem auditoria.

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

## Vercel

1. Publique este repositório na Vercel (framework: **Other**).
2. Em **Settings → Environment Variables**, cadastre:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
3. O `vercel.json` já define `npm run build`, que gera `js/env.js` no deploy.
4. Atualize as Redirect URLs do Supabase com o domínio da Vercel.
5. Não cadastre `service_role` nas variáveis do frontend.

## Segurança de `profiles` e RLS

- MOBILIZADOR consulta apenas o próprio perfil.
- MOBILIZADOR não altera `perfil` nem `status` (trigger no banco).
- ADMIN ativo consulta e atualiza perfis, preparado para a futura tela de usuários.
- A verificação de ADMIN **não** é feita com um `SELECT` direto em `profiles` dentro da policy, para evitar recursão de RLS. Usamos a função `public.eh_administrador()`, `SECURITY DEFINER`, documentada em `sql/002_rls_policies.sql`.
- Esconder o menu **Usuários** no frontend não é autorização. A autorização real está no banco.

## Estrutura

```
.
├── index.html
├── pages/
│   ├── dashboard.html
│   ├── recuperar-senha.html
│   └── redefinir-senha.html
├── css/
├── js/
├── assets/images/
├── sql/
├── scripts/gerar-env.js
├── .env.example
├── vercel.json
└── README.md
```

Os arquivos foram colocados na raiz do repositório (e não em uma subpasta `unisol-rs-relatorios`) para o deploy na Vercel funcionar sem configuração extra de diretório.

A marca em `assets/images/logo-unisol.svg` é um **espaço provisório**. Substitua pelo logotipo oficial quando ele for disponibilizado.

## O que vem depois

Nas próximas etapas: atividades, fotografias no Supabase Storage, histórico, reabertura, auditoria e relatórios Word. Essas tabelas ainda **não** foram criadas.
