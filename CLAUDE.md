# Media Bar Encore

Fork do [Media Bar Enhanced](https://github.com/CodeDevMLH/jellyfin-plugin-media-bar-enhanced) (MBE, CodeDevMLH,
GPL-3), que por sua vez é fork do Media Bar do MakD, para o Jellyfin 12.4 da VPS do Angelo. Responda em português do
Brasil. O Angelo é iniciante: explique o porquê das mudanças em uma ou duas frases.

Este repositório é **público** (fork de repositório público). Nada de segredos, IPs, nomes de usuários ou detalhes da
VPS aqui. A operação (Jellyfin, Caddy, backups, PreProbe) está no `~/ops/CLAUDE.md`, que é a referência; as decisões e o
histórico estão em `~/ops/plano-jellyfin-personalizacao.md` (seção "Sessão 6") e nas notas de sessão do `~/ops`. O
desenvolvimento é feito pela sessão **ops** (não há sessão de Remote Control própria).

## Branches e sincronia com o upstream

- `origin` = `ApenasAngelo/jellyfin-plugin-media-bar-encore`; `upstream` = `CodeDevMLH/jellyfin-plugin-media-bar-enhanced`.
- `main` **espelha** a `main` do upstream: nunca commitar nela. O upstream também tem `dev` (só olhar).
- `encore` é a branch de trabalho e a padrão do GitHub. Recebe a `main` **por merge** (nunca rebase do que já foi
  publicado):
  ```bash
  git fetch upstream
  git switch main && git merge --ff-only upstream/main && git push origin main
  git switch encore && git merge main      # resolver conflitos só nos ganchos // Encore:
  ```
- `README.md` usa `merge=ours` (`.gitattributes`): o nosso sempre vence. Num clone novo, rodar uma vez
  `git config merge.ours.driver true`.
- Sem PRs para o upstream (decisão do Angelo). O autor lança versão a cada poucos dias: sincronizar com frequência.

## Regras do fork

- Tudo o que for novo vai em **arquivos novos** (JS e CSS próprios em `Jellyfin.Plugin.MediaBarEnhanced/Web/encore/`,
  C# em pastas `Encore`). Nos arquivos do autor, só **ganchos curtos marcados com `// Encore:`** (ou `/* Encore: */`).
- GUID, nome e assembly próprios: o GUID do MBE está em `MediaBarEnhancedPlugin.cs` (`d7e11d57-...`) e há outro em
  `ScriptInjector.cs` (registro no File Transformation). Os dois mudam.
- O `manifest.json` da raiz e os workflows `.github/workflows/release_automation.yml`/`build.yaml` são do upstream: não
  usar. No fork, o GitHub deixa as Actions desligadas; os nossos workflows terão nomes próprios.
- O `.gitignore` do autor ignora `CLAUDE.md`; este arquivo foi adicionado com `git add -f` e, rastreado, segue normal.
  Não mexer no `.gitignore` dele por isso.
- Commits em **inglês** (repositório público, pode receber contribuições), Conventional Commits, atômicos (ex.: `feat(trailer): pause when the banner scrolls out of view`).
  O `CLAUDE.md` e a conversa continuam em português.

## Como o MBE funciona (lido em 2026-10-29)

- `Jellyfin.Plugin.MediaBarEnhanced/Web/mediaBarEnhanced.js` (≈9,8 mil linhas) e `.css`: tudo do cliente num arquivo.
  "Só na home" aparece em vários pontos (`isOnHomePage`, checagens de `#/home` perto das linhas 864, 3769, 3948, 6680):
  levar às abas exige um gancho central nosso em vez de editar cada ponto.
- Injeção: `ScriptInjector.cs` tenta gravar no `index.html` e, sem permissão (o caso da VPS), registra no File
  Transformation.
- O CSS posiciona o `.homeSectionsContainer` (`top: 68vh` no desktop do 12): o Home Screen Sections Encore desenha no
  mesmo container.
- `TargetFramework` é `net9.0` mesmo para o 12; o Jellyfin 12.4 roda .NET 10: conferir se compila e carrega assim.

## Cuidados com o servidor

- **PreProbe do Gelato:** o Caddy (bloco `watch`, `@mediabar`) tira `MediaSources` do pedido de itens do Media Bar,
  casando **por conteúdo**. Os pedidos do Encore precisam continuar casando; conferir que a home não gera
  `Probing stream` no log do Jellyfin antes de liberar qualquer versão. Detalhes no `~/ops/CLAUDE.md`.
- A troca do MBE pelo Encore migra a configuração atual (XML do MBE, com cópia antes) e remove o repositório do
  CodeDevMLH do Jellyfin. Instalar, trocar ou reiniciar só com o OK do Angelo e com backup (`/data/backups/jellyfin/`).
- Capturas: `~/ops/scripts/jellyfin-captura.sh` (conta `claude-teste`; reproduz o filtro do Caddy).

## Build e publicação

- Build na VPS (ARM64) só em container do .NET SDK (nada de SDK instalado no sistema).
- Publicação: release por tag `vX.Y.Z.W` (GitHub Actions nossa) e entrada no manifesto do repositório de plugins
  `ApenasAngelo/jellyfin-plugins`. A montar na sessão 7 (`~/ops/prompts/jellyfin-sessao-7.md`).

## Pendências do fork

- S8: pausar o trailer quando o banner sai da tela (`IntersectionObserver`), em arquivo novo.
- Fase 3 (feita, 2026-10-30): nas páginas `#/home?topParentId=` os slides vêm da biblioteca ou coleção (`mediaBarEncoreView` em `encore/encore.js`; a aba Coleções não tem banner). O pedido por item (`Fields=`) não mudou: o filtro do Caddy casa por conteúdo.
- A pausa é um estado conferido a cada 100 ms (`holdThePause`), não reação a eventos: os slides são refeitos a cada página. Vale até o usuário despausar, inclusive em outras páginas.
- Cada página abre com a lista de slides salva no navegador (14 dias) e pede outra em segundo plano após 15 s (`savedSlideLists`); a 1ª visita de um aparelho ainda espera o servidor. Sem indicação de carregamento: ver na fase 4.
