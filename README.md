# Controle FibraCenter — versão online

## O que existe no projeto

A versão anterior era um único arquivo HTML, com CSS e JavaScript embutidos, sem framework, servidor ou banco. A lista era guardada no `localStorage` do navegador. A versão autônoma continua em `../controle-clientes-serasa.html`.

Esta pasta adiciona a infraestrutura online sem trocar a interface principal: Vite serve o HTML/CSS/JavaScript atual, `@supabase/supabase-js` liga o navegador ao Supabase, e o PostgreSQL guarda uma lista compartilhada. A sessão de login é mantida pelo Supabase Auth no armazenamento do navegador. As permissões são aplicadas no PostgreSQL com RLS; a aplicação não usa chave administrativa nem API própria.

## Papéis e acesso

- `pending`: toda conta criada pelo formulário público começa sem acesso aos dados.
- `operator`: pode ler, cadastrar e atualizar a lista compartilhada.
- `admin`: tem as permissões de operador, pode excluir cadastros e autorizar usuários pelo menu de três linhas no topo.

O banco repete essas regras com RLS, portanto esconder botões na interface não é a barreira de segurança. Um administrador libera operadores pelo menu **Autorizar usuários**. A primeira conta admin deve ser promovida uma vez pelo SQL Editor. Isso evita que qualquer pessoa que encontre o endereço público se cadastre e passe a ler os dados dos clientes.

## Requisitos

- Node.js 20.19+ e npm.
- Uma conta/projeto Supabase.
- Uma conta Vercel e um repositório Git para publicar.

## 1. Criar o projeto no Supabase

1. Crie um projeto no Supabase e escolha uma senha forte para o banco. A senha do banco não é usada pela aplicação.
2. No painel do projeto, abra **SQL Editor** e execute primeiro `supabase/migrations/202611050001_shared_clients.sql` e depois `supabase/migrations/202611050002_csv_monthly_reporting.sql`.
3. Em **Project Settings → API Keys**, copie a Project URL e a chave **Publishable** (`sb_publishable_...`). A antiga chave `anon` também é uma chave pública de cliente, mas prefira a Publishable nos projetos novos.
4. Em **Authentication → Providers → Email**, mantenha habilitado o provedor de e-mail. Em produção, configure o envio/SMTP de e-mails para confirmações e recuperação de senha.
5. Em **Authentication → URL Configuration**, configure:
   - **Site URL**: o endereço principal publicado, por exemplo `https://seu-projeto.vercel.app`.
   - **Redirect URLs**: `http://localhost:5173/**`, `https://seu-projeto.vercel.app/**` e, se usar domínio próprio, `https://seu-dominio.com/**`.

A tela envia os links de confirmação e recuperação para a origem em que o site está aberto. Se mudar o domínio, inclua a nova origem na lista de Redirect URLs.

## 2. Rodar localmente

No terminal, entre nesta pasta do projeto e instale as dependências:

```bash
npm install
```

Copie `.env.example` para `.env.local` e preencha os valores do Supabase:

```dotenv
VITE_SUPABASE_URL=https://seu-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_sua_chave_publica
```

Inicie o servidor local:

```bash
npm run dev
```

Abra `http://localhost:5173`. Cadastre a primeira conta. Se a confirmação por e-mail estiver ligada, confirme o link recebido e entre no sistema.

## 3. Autorizar a primeira conta e usuários seguintes

A conta inicial também fica `pending`. No **SQL Editor** do Supabase, promova o e-mail confiável que será administrador:

```sql
update public.profiles
set role = 'admin'
where lower(email) = lower('seu-email@empresa.com');
```

O administrador pode autorizar outros usuários como operadores pelo mesmo painel:

```sql
update public.profiles
set role = 'operator'
where lower(email) = lower('colega@empresa.com');
```

Novas inscrições continuam pendentes até essa autorização. Só `admin` pode excluir registros; a regra também está nas políticas RLS.

## 4. Levar a lista que está no navegador para o banco

A lista antiga está no `localStorage` do navegador e não é automaticamente visível para um endereço de hospedagem diferente. Para transferi-la:

1. Abra `../controle-clientes-serasa.html` no mesmo navegador e aparelho em que os cadastros foram feitos.
2. Use **Exportar backup** para baixar `backup-local-fibracenter.json`.
3. Abra a versão online, entre com uma conta autorizada e use **Importar dados locais** para selecionar esse JSON.
4. Aguarde a mensagem de importação e confira os registros. A importação pode ser repetida: ela usa o identificador antigo para atualizar duplicatas em vez de criar cópias.
5. Use **Exportar backup** na versão online para guardar uma cópia dos dados hospedados.

O arquivo de backup contém dados pessoais e de cobrança. Guarde-o apenas em local autorizado e exclua cópias temporárias após a migração.

## 5. Publicar na Vercel

1. Envie o conteúdo desta pasta (`controle-fibracenter-online`) para um repositório Git. Se a pasta estiver dentro de um monorepositório, configure **Root Directory** da Vercel para `outputs/controle-fibracenter-online`.
2. Na Vercel, importe o repositório. Use o preset Vite, comando de build `npm run build` e pasta de saída `dist`.
3. Em **Project Settings → Environment Variables**, adicione `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` para Production e Preview. A Publishable key foi feita para uso no navegador; nunca coloque `service_role`, secret key, senha do banco ou token administrativo nessas variáveis.
4. Faça o deploy. A configuração `vercel.json` encaminha caminhos da aplicação ao `index.html`.
5. Copie o endereço gerado pela Vercel para **Authentication → URL Configuration → Site URL** e **Redirect URLs** no Supabase. Inclua também o domínio próprio, se houver. Depois faça um novo deploy caso altere variáveis de ambiente.
6. Cadastre e confirme as contas, promova um administrador e autorize os operadores.

## Variáveis de ambiente

| Variável | Uso | É segredo? |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Endereço do projeto Supabase | Não |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Chave pública de cliente do Supabase | Não; fica no bundle do navegador e depende de RLS para proteger os dados |

Não existe chave `service_role` no frontend. As credenciais de login são processadas pelo Supabase Auth; o código não grava senhas próprias.

## Banco e segurança

A migração cria `profiles` e `clients`, índices, triggers de perfil e atualização, e políticas RLS. Contas autenticadas pendentes não podem consultar nem modificar `clients`. Operadores e administradores acessam a mesma lista. A função SQL `can_access_clients()` é usada pelas políticas de leitura/escrita; `is_admin()` limita exclusões e administração de papéis. As políticas são verificadas no banco, no servidor do Supabase.

Para publicar mudanças posteriores no esquema, adicione uma nova migração em `supabase/migrations/` em vez de editar uma migração já aplicada.

## Documentação oficial

- [Supabase Auth com senha e recuperação](https://supabase.com/docs/guides/auth/passwords)
- [URLs permitidas para confirmação e recuperação](https://supabase.com/docs/guides/auth/redirect-urls)
- [Chaves Publishable e Secret](https://supabase.com/docs/guides/getting-started/api-keys)
- [Row Level Security no PostgreSQL](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Vite na Vercel](https://vercel.com/docs/frameworks/frontend/vite)

# Complemento: importação CSV, visão mensal e relatórios

## Importar a planilha de clientes suspensos

Entre com uma conta autorizada e use **Importar CSV**. O importador aceita o CSV da planilha `clientes suspensos - Clientes.csv`, incluindo acentos, cabeçalhos com espaços, vírgulas e campos CSV entre aspas. Ele reconhece:

- `ID OCORRÊNCIA` como identificador de atualização, para uma reimportação atualizar o mesmo cadastro;
- `CONTRATO - NOME/RAZÃO SOCIAL` como número do contrato;
- a terceira coluna sem título como nome do cliente;
- `Endereço`, `Bairro`, `Cidade`, `NEGATIVADO`, `DATA NEGATIVAÇÃO` e `DATA REGULARIZAÇÃO`;
- todos os outros campos como dados de origem em `source_data`, mantendo observações, datas de contato e dados de equipamento.

São criados cadastros apenas quando há nome, contrato, endereço, bairro e cidade. Linhas incompletas são ignoradas e o resumo informa quantas foram ignoradas. No arquivo fornecido, 280 linhas contêm dados de cliente completos e 172 linhas `NÃO` não possuem identificação nem endereço; essas 172 linhas não viram cadastros vazios.

Situações suportadas: `REGULARIZADO`, `SIM`, `NÃO` e `EM CONTATO`. A situação antiga `NEGATIVADO` é mantida no campo legado para compatibilidade com o esquema atual. Clientes importados como regularizados recebem a observação original quando preenchida; quando não há texto de regularização na planilha, o sistema registra que o item foi importado da planilha.

## Navegação e relatórios

- A **Visão mensal** abre por padrão e mostra, para cada mês, quem foi negativado e quem foi regularizado, com contagens e datas. Selecionar o nome abre o cadastro.
- Em **Clientes**, altere a situação para `SIM`, `NÃO`, `EM CONTATO` ou `REGULARIZADO`. A regularização continua exigindo a descrição do que foi feito.
- Em **Relatórios**, a pizza de negativações agrupa ocorrências pelo mês da data de negativação; a pizza de situação total conta clientes atuais por situação; o gráfico de colunas compara regularizações registradas por mês com clientes atualmente `SIM` agrupados pelo mês da negativação.
- Administradores abrem o menu de três linhas no topo para autorizar, rebaixar ou tornar administradores de usuários cadastrados.
- O tema claro/escuro é alternado pelo ícone no topo.

## Migração do banco

Depois de aplicar a migração anterior, aplique também `supabase/migrations/202611050002_csv_monthly_reporting.sql` no SQL Editor do Supabase. Ela adiciona os campos de situação da planilha, datas de evento, ID da ocorrência e os dados originais em JSON. Não edite uma migração que já tenha sido executada.
