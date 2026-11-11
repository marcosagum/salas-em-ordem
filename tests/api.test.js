// Testa o servidor de verdade: sobe o server.js numa pasta temporária, com as três senhas.
//   node tests/api.test.js
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let falhas = 0;
function check(nome, cond, extra) {
  if (cond) console.log('  OK   ' + nome);
  else { falhas++; console.log('  FAIL ' + nome + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

const PORTA = 3900 + Math.floor(Math.random() * 90);
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rearme-'));
const base = `http://127.0.0.1:${PORTA}`;

async function pedir(metodo, url, corpo, cookie) {
  const r = await fetch(base + url, {
    method: metodo,
    headers: { ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined
  });
  const txt = await r.text();
  let d = null; try { d = txt ? JSON.parse(txt) : null; } catch (_) {}
  return { status: r.status, d, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORTA), DADOS_DIR: DIR, SENHA: 'equipe1', SENHA_ADMIN: 'admin1', SENHA_CONSULTA: 'ver1' },
    stdio: ['ignore', 'pipe', 'inherit']
  });
  await new Promise(ok => srv.stdout.on('data', d => { if (/no ar/.test(d)) ok(); }));
  try {
    console.log('\n1. Sem senha');
    check('página abre', (await pedir('GET', '/')).status === 200);
    check('saúde responde', (await pedir('GET', '/api/health')).d.salas === 13);
    check('dados pedem senha', (await pedir('GET', '/api/dados')).status === 401);
    check('senha errada é recusada', (await pedir('POST', '/api/entrar', { senha: 'x' })).status === 401);

    const adm = (await pedir('POST', '/api/entrar', { senha: 'admin1' })).cookie;
    const eq = (await pedir('POST', '/api/entrar', { senha: 'equipe1' })).cookie;
    const ver = (await pedir('POST', '/api/entrar', { senha: 'ver1' })).cookie;

    console.log('\n2. Dados iniciais do relatório de 08/10');
    const d = (await pedir('GET', '/api/dados', undefined, adm)).d;
    check('papel administrador', d.papel === 'admin');
    check('13 salas', d.catalogo.salas.length === 13);
    check('136 peças', d.catalogo.salas.reduce((a, s) => a + s.itens.reduce((b, i) => b + i.qtd, 0), 0) === 136);
    check('21 itens', Object.keys(d.catalogo.tipos).length === 21);
    check('papel equipe', (await pedir('GET', '/api/dados', undefined, eq)).d.papel === 'equipe');
    check('papel consulta', (await pedir('GET', '/api/dados', undefined, ver)).d.papel === 'consulta');

    console.log('\n3. Rearme e conferência');
    check('consulta não cria rearme', (await pedir('POST', '/api/rearmes', { nome: 'X' }, ver)).status === 403);
    check('rearme sem nome é recusado', (await pedir('POST', '/api/rearmes', { nome: ' ' }, eq)).status === 400);
    const cria = await pedir('POST', '/api/rearmes', { nome: 'Mariah Carey', data: '2026-11-15' }, eq);
    check('equipe cria rearme', cria.status === 200 && /^r/.test(cria.d.id), cria);
    const id = cria.d.id;
    const reg = { contagem: { 'mesa-bistro': 2, banqueta: 12, 'lixeira-inox': 1 }, obs: 'ok', conferidaPor: 'Marcos', conferidaEm: new Date().toISOString() };
    check('consulta não confere', (await pedir('PUT', `/api/rearmes/${id}/salas/c-05`, reg, ver)).status === 403);
    check('equipe confere a C-05', (await pedir('PUT', `/api/rearmes/${id}/salas/c-05`, reg, eq)).status === 204);
    check('sala inexistente', (await pedir('PUT', `/api/rearmes/${id}/salas/z-99`, reg, eq)).status === 404);
    check('item fora da lista é recusado', (await pedir('PUT', `/api/rearmes/${id}/salas/c-05`, { ...reg, contagem: { geladeira: 1 } }, eq)).status === 400);
    check('quantidade negativa é recusada', (await pedir('PUT', `/api/rearmes/${id}/salas/c-05`, { ...reg, contagem: { banqueta: -1 } }, eq)).status === 400);
    check('sem quem conferiu é recusado', (await pedir('PUT', `/api/rearmes/${id}/salas/c-05`, { ...reg, conferidaPor: '' }, eq)).status === 400);
    check('campo estranho é recusado', (await pedir('PUT', `/api/rearmes/${id}/salas/c-05`, { ...reg, hack: 1 }, eq)).status === 400);
    const d2 = (await pedir('GET', '/api/dados', undefined, ver)).d;
    check('consulta vê a conferência', d2.rearmes[id].salas['c-05'].contagem['mesa-bistro'] === 2);
    check('conferir de novo substitui (não mistura)', (await pedir('PUT', `/api/rearmes/${id}/salas/c-05`, { ...reg, contagem: { banqueta: 12 } }, eq)).status === 204
      && (await pedir('GET', '/api/dados', undefined, eq)).d.rearmes[id].salas['c-05'].contagem['mesa-bistro'] === undefined);
    check('equipe apaga conferência', (await pedir('DELETE', `/api/rearmes/${id}/salas/c-05`, undefined, eq)).status === 204);

    console.log('\n4. Previsto das salas (só administrador)');
    const cat = JSON.parse(JSON.stringify(d.catalogo));
    cat.tipos.frigobar = { id: 'frigobar', nome: 'Frigobar' };
    cat.salas.push({ id: 't-40', codigo: 'T-40', nome: 'Sala de Produção T-40', grupo: 'Produção', itens: [{ tipoId: 'frigobar', qtd: 1 }] });
    check('equipe não muda o previsto', (await pedir('PUT', '/api/catalogo', cat, eq)).status === 403);
    check('administrador muda o previsto', (await pedir('PUT', '/api/catalogo', cat, adm)).status === 204);
    check('agora são 14 salas', (await pedir('GET', '/api/dados', undefined, eq)).d.catalogo.salas.length === 14);
    const ruim = JSON.parse(JSON.stringify(cat)); ruim.salas[0].itens.push({ tipoId: 'nao-existe', qtd: 1 });
    check('item que não está na lista é recusado', (await pedir('PUT', '/api/catalogo', ruim, adm)).status === 400);
    const dup = JSON.parse(JSON.stringify(cat)); dup.salas.push(dup.salas[0]);
    check('sala repetida é recusada', (await pedir('PUT', '/api/catalogo', dup, adm)).status === 400);

    console.log('\n5. Apagar rearme');
    check('equipe não apaga rearme', (await pedir('DELETE', `/api/rearmes/${id}`, undefined, eq)).status === 403);
    check('administrador apaga rearme', (await pedir('DELETE', `/api/rearmes/${id}`, undefined, adm)).status === 204);

    console.log('\n6. Gravado no disco');
    const arq = JSON.parse(fs.readFileSync(path.join(DIR, 'rearme.json'), 'utf8'));
    check('arquivo tem 14 salas', arq.catalogo.salas.length === 14);
    check('cópia do dia existe', fs.readdirSync(path.join(DIR, 'copias')).length === 1);
  } finally {
    srv.kill();
    fs.rmSync(DIR, { recursive: true, force: true });
  }
  console.log(falhas ? `\n${falhas} TESTE(S) FALHARAM` : '\nTODOS OS TESTES PASSARAM');
  process.exit(falhas ? 1 : 0);
})();
