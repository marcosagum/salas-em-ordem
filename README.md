# Rearme das Salas · Farmasi Arena

Depois de cada evento, a equipe confere as salas de produção e os camarins. O sistema compara o que tem em cada sala com o previsto e monta a lista de rearme: o que buscar no depósito, o que remanejar de uma sala para outra e o que levar de volta. A lista pode ser copiada para o WhatsApp ou impressa.

- `public/pagina.html`: a página inteira.
- `server.js`: servidor sem dependências (Node 20). Guarda tudo em `DADOS_DIR/rearme.json` e faz uma cópia por dia em `DADOS_DIR/copias` (guarda as últimas 30).
- `inicial.json`: o previsto das 13 salas, tirado do "Relatório de Mobiliário das Salas" de 08/10/2026 (136 peças, com os nomes padronizados). Só é usado na primeira vez que o servidor sobe com o volume vazio. Depois disso, o previsto é mudado pela aba **Salas**.
- Link direto para um rearme: `.../#r=<id>`. A página já atualiza o endereço quando um rearme é aberto, então basta copiar o link do navegador.

## Senhas (variáveis no Coolify)
| Variável | Quem usa | O que pode |
|---|---|---|
| `SENHA_ADMIN` | Administrador | Tudo, inclusive editar o previsto das salas (criar, mudar e tirar salas) e apagar rearmes |
| `SENHA` | Equipe de operações | Criar rearme, conferir salas, marcar como rearmada, apagar a conferência de uma sala |
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
