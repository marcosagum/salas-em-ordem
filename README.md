# Salas em Ordem · Farmasi Arena

Depois de cada evento, a equipe confere as salas de produção e os camarins. O sistema compara o que tem em cada sala com o previsto e cruza as sobras com as faltas: primeiro dentro do mesmo bloco (camarins com camarins, produção com produção), depois entre blocos e só então com o depósito. O resultado é a lista do que fazer: trocas entre salas, o que buscar no depósito e o que levar de volta. A lista pode ser copiada para o WhatsApp ou impressa numa folha com as cores do sistema.

- `public/pagina.html`: a página inteira (ícones de traço em SVG, sem emoji).
- `server.js`: servidor sem dependências (Node 20). Guarda tudo em `DADOS_DIR/rearme.json` e faz uma cópia por dia em `DADOS_DIR/copias` (guarda as últimas 30).
- `inicial.json`: o previsto das 13 salas, tirado do "Relatório de Mobiliário das Salas" de 08/10/2026 (136 peças, com os nomes padronizados). Cada sala tem um bloco (`grupo`: Camarim ou Produção). Só é usado na primeira vez que o servidor sobe com o volume vazio. Depois disso, o previsto é mudado pela aba **Salas**.
- Endereço direto para uma checagem: `.../#r=<id>` (serve para o portal de operações).

## Senhas (variáveis no Coolify)
| Variável | Quem usa | O que pode |
|---|---|---|
| `SENHA_ADMIN` | Administrador | Tudo, inclusive editar o previsto das salas (criar, mudar e tirar salas) e apagar checagens |
| `SENHA` | Equipe de operações | Criar checagem, conferir salas, marcar sala em ordem, apagar a conferência de uma sala |
| `SENHA_CONSULTA` | Outro setor | Só ver |

As regras valem no servidor, não só na tela. Nunca escreva as senhas neste repositório.

## Coolify
- Build pack: Dockerfile. Porta: 3000.
- Volume persistente montado em `/app/dados` (sem ele, os dados somem a cada deploy).
- Variáveis `SENHA_ADMIN`, `SENHA` e `SENHA_CONSULTA`.

## Rodar no computador
`SENHA=equipe SENHA_ADMIN=admin SENHA_CONSULTA=ver node server.js` e abrir http://localhost:3000. Sem nenhuma senha, entra direto como administrador.

## Testes
`npm install` (instala o jsdom) e depois `npm test`.
