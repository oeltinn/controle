# Controle FibraCenter — versão online

## O que existe no projeto

A versão anterior era um único arquivo HTML, com CSS e JavaScript embutidos, sem framework, servidor ou banco. A lista era guardada no `localStorage` do navegador. A versão autônoma continua em `../controle-clientes-serasa.html`.

Esta pasta adiciona a infraestrutura online sem trocar a interface principal: Vite serve o HTML/CSS/JavaScript atual, `@supabase/supabase-js` liga o navegador ao Supabase, e o PostgreSQL guarda uma lista compartilhada. A sessão de login é mantida pelo Supabase Auth no armazenamento do navegador. As permissões são aplicadas no PostgreSQL com RLS; a aplicação não usa chave administrativa nem API própria.

## Papéis e acesso

- `pending`: toda conta criada pelo formulário público começa sem acesso aos dados.
- `technician`: acessa somente a fila de retirada de ONU e registra visitas.
- `attendant`: acessa Clientes e a fila de retirada de ONU.
- `operator`: acessa a visão geral, clientes, relatórios e as filas de retirada.
- `admin`: tem as permissões de operador, pode excluir cadastros e autorizar usuários pelo menu de três linhas no topo.

O banco repete essas regras com RLS, portanto esconder botões na interface não é a barreira de segurança. Um administrador libera operadores pelo menu **Autorizar usuários**. A primeira conta admin deve ser promovida uma vez pelo SQL Editor. Isso evita que qualquer pessoa que encontre o endereço público se cadastre e passe a ler os dados dos clientes.

## Requisitos

- Node.js 20.19+ e npm.
- Uma conta/projeto Supabase.
- Uma conta Vercel e um repositório Git para publicar.

## 1. Criar o projeto no Supabase

1. Crie um projeto no Supabase e escolha uma senha forte para o banco. A senha do banco não é usada pela aplicação.
2. No painel do projeto, abra **SQL Editor** e execute, em ordem, `supabase/migrations/202611050001_shared_clients.sql`, `supabase/migrations/202611050002_csv_monthly_reporting.sql`, `supabase/migrations/202611050003_technician_withdrawals.sql` e `supabase/migrations/202611050004_attendant_role.sql`.
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

O administrador pode autorizar técnicos e atendentes pelo menu de três linhas. Se precisar promover pelo SQL Editor, execute:

```sql
update public.profiles
set role = 'attendant'
where lower(email) = lower('colega@empresa.com');
```

Novas inscrições pedem nome completo e continuam pendentes até a autorização. Técnicos só acessam retirada de ONU; atendentes acessam Clientes e Retirada de ONU; operadores e administradores acessam todas as páginas. Só `admin` pode excluir registros da lista de inadimplência; as regras também são aplicadas no banco por RLS.

## 4. Publicar na Vercel

1. Envie o conteúdo desta pasta (`controle-fibracenter-online`) para um repositório Git. Se a pasta estiver dentro de um monorepositório, configure **Root Directory** da Vercel para `outputs/controle-fibracenter-online`.
2. Na Vercel, importe o repositório. Use o preset Vite, comando de build `npm run build` e pasta de saída `dist`.
3. Em **Project Settings → Environment Variables**, adicione `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` para Production e Preview. A Publishable key foi feita para uso no navegador; nunca coloque `service_role`, secret key, senha do banco ou token administrativo nessas variáveis.
4. Faça o deploy. A configuração `vercel.json` encaminha caminhos da aplicação ao `index.html`.
5. Copie o endereço gerado pela Vercel para **Authentication → URL Configuration → Site URL** e **Redirect URLs** no Supabase. Inclua também o domínio próprio, se houver. Depois faça um novo deploy caso altere variáveis de ambiente.
6. Cadastre e confirme as contas, promova um administrador e autorize os operadores.

O menu do perfil mostra o e-mail, permite editar nome e telefone, trocar a senha com confirmação da senha atual e sair da conta. A primeira entrada mostra “Bem-vindo”; as próximas entradas mostram “Bem-vindo de volta”.

## Variáveis de ambiente

| Variável | Uso | É segredo? |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Endereço do projeto Supabase | Não |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Chave pública de cliente do Supabase | Não; fica no bundle do navegador e depende de RLS para proteger os dados |

Não existe chave `service_role` no frontend. As credenciais de login são processadas pelo Supabase Auth; o código não grava senhas próprias.

## Banco e segurança

A migração cria `profiles` e `clients`, índices, triggers de perfil e atualização, e políticas RLS. Contas autenticadas pendentes não podem consultar nem modificar `clients`. Atendentes, operadores e administradores acessam a lista compartilhada. A função SQL `can_access_clients()` é usada pelas políticas de leitura/escrita; `is_admin()` limita exclusões e administração de papéis. As políticas são verificadas no banco, no servidor do Supabase.

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

- A **Visão geral** exibe somente totais e evolução mensal, sem nomes de clientes. Inclui retiradas confirmadas, pendências e totais por técnico.
- Em **Negativações → Clientes**, altere a situação para `SIM`, `NÃO`, `EM CONTATO` ou `REGULARIZADO`. A regularização continua exigindo a descrição do que foi feito.
- Em **Negativações → Relatórios**, a pizza de negativações agrupa ocorrências pelo mês da data de negativação; a pizza de situação total conta clientes atuais por situação; o gráfico de colunas compara regularizações registradas por mês com clientes atualmente `SIM` agrupados pelo mês da negativação. Essa página fica disponível apenas para operadores e administradores.
- Administradores abrem o menu de três linhas no topo para autorizar, rebaixar ou tornar administradores de usuários cadastrados.
- No computador e no celular, o tema e a conta ficam no menu de três linhas. O tema escolhido persiste no login; a primeira visita usa tema claro.

## Migração do banco

As migrações `202611050002_csv_monthly_reporting.sql` e `202611050003_technician_withdrawals.sql` adicionam os campos da planilha e a fila de retirada. A nova `202611050004_attendant_role.sql` libera o papel de atendente para clientes e retirada e atualiza as funções de permissão RLS. Não edite uma migração que já tenha sido executada.

# Retirada de ONU e contas de técnicos

Cadastros criados em `supabase/migrations/202611050003_technician_withdrawals.sql` adicionam nome obrigatório e telefone opcional ao perfil, função `technician`, fila compartilhada de retirada de ONU e histórico de visitas. A migração seguinte adiciona `attendant` com acesso apenas a Clientes e Retirada de ONU.

No menu de usuários, um administrador pode autorizar cada conta como **Técnico**, **Atendente**, **Operador**, **Administrador** ou manter **Pendente**. A conta deve ser cadastrada com nome completo; cada pessoa edita também o telefone opcional em **Minha conta**. Técnicos e atendentes veem a lista de retirada, abrem o cliente e marcam **Ainda não fui**, **Já fui** ou **Não encontrei ninguém**. Visitas sem contato ficam registradas com o nome da pessoa e aparecem na visão geral para os demais usuários autorizados.

Na página **Retirada de ONU**, o cadastro exige nome, endereço e equipamento; telefone é opcional. O CSV aceita cabeçalhos como `Nome`, `Telefone`, `Endereço`, `Equipamento` (também reconhece `Rua`, `Bairro`, `Cidade`, `Modelo` e `ONU`). Endereços em colunas de rua/bairro/cidade são reunidos. O importador detecta separador por vírgula, ponto e vírgula ou tabulação e ignora linhas sem nome, endereço ou equipamento.

## Atualização do dashboard e navegação

Após as migrações anteriores, aplique em ordem:

1. `supabase/migrations/20261106180115_confirmed_equipment_collection.sql`
2. `supabase/migrations/20261106180424_restrict_anonymous_functions.sql`

A primeira inclui o resultado **Equipamento retirado**, sempre com observação obrigatória e identificação do usuário no servidor. O total de retiradas concluídas conta um cadastro por vez, considerando o último resultado. Visitas antigas marcadas apenas como **Já fui** não são convertidas automaticamente em recolhimentos. A segunda remove permissões anônimas explícitas das funções internas; usuários autorizados continuam usando as mesmas políticas RLS.

A aba **Negativações** reúne Clientes e Relatórios. Em Clientes, os quadros **Clientes em acompanhamento** (SIM/NÃO), **Em contato** e **Regularizados** podem ser recolhidos e expandidos. Administradores e operadores acessam todas as páginas; atendentes acessam Clientes e Retirada de ONU; técnicos acessam somente Retirada de ONU.

A aba atual é salva por usuário em `sessionStorage`. Renovar a sessão ou voltar ao navegador não reinicia a tela nem os formulários abertos. Atualizar a página recupera a aba, mas não recupera formulários ainda não enviados. O tema usa `localStorage`.

Os gráficos mensais contam as datas cadastradas de negativação e regularização, incluindo meses intermediários sem eventos. O sistema não mantém ciclos anteriores de negativação de um mesmo cadastro. As consultas são paginadas para que os totais não parem nos primeiros 1.000 registros.

Validação: testes de interface com dados fictícios para os quatro perfis, em 390px e 1280px; totais, grupos, navegação, renovação de sessão, tema e sobreposição da conta. A função de retirada foi testada no banco em uma transação revertida, verificando atribuição do técnico e rejeição de observação vazia. Nenhum registro de teste foi mantido.

## Notificações no aplicativo e no Android

As migrações `20261109182947_web_notifications.sql` e `20261109183629_restrict_notification_table_grants.sql` criam a caixa de entrada e as inscrições de Web Push. A função `/api/notifications` da Vercel valida a sessão e a função **Administrador** no servidor. A função SQL escolhe usuários autorizados por função ou por conta individual e impõe limite de 20 mensagens por hora a cada administrador. A mensagem permanece na caixa de entrada mesmo sem inscrição em notificações do dispositivo. As chaves de inscrição não são consultáveis pelo navegador; somente a função da Vercel, com a chave de servidor, pode lê-las.

1. Configure `VITE_VAPID_PUBLIC_KEY` como variável pública do Vite e `VAPID_PRIVATE_KEY` como variável privada da Vercel. Gere o par de chaves com `web-push.generateVAPIDKeys()`; guarde a privada fora do repositório. A integração também precisa de `SUPABASE_SERVICE_ROLE_KEY` apenas na Vercel, além de `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` já usadas pelo aplicativo.
2. Publique pela Vercel em HTTPS. O serviço `/push-sw.js` e o manifesto `/manifest.webmanifest` são servidos da pasta `public`.
3. Cada usuário entra na conta e toca em **Ativar notificações neste dispositivo** no menu. No Android, aceita a permissão do Chrome. Pode voltar ao menu para desativar. Ao sair da conta, a inscrição desse dispositivo é removida.
4. Um administrador abre **Enviar notificação** no menu, informa título e mensagem e escolhe uma função ou um usuário específico. O sino abre a caixa de entrada e mostra a quantidade de mensagens não lidas.

Avisos externos dependem do suporte do navegador, da permissão local e de conexão do dispositivo. O envio informa quantos dispositivos aceitaram o Web Push; os demais destinatários ainda recebem a mensagem na caixa de entrada. Para desenvolvimento local da rota `/api/notifications`, use `vercel dev` com as variáveis de servidor configuradas.

## Aparência

As superfícies, cores, estados de foco, botões e espaçamentos seguem a hierarquia visual do Material Design 3, preservando o verde da marca. Os quadros **Negativados**, **Clientes em acompanhamento** e **Regularizados** começam recolhidos em Negativações. O rodapé da interface mostra `© 2026 Kontroll. Desenvolvido por Elton Augusto`.
