// Testa a página de verdade (jsdom) falando com o server.js de verdade.
//   npm install   (instala o jsdom)
//   node tests/pagina.test.js
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

let falhas = 0;
function check(nome, cond, extra) {
  if (cond) console.log('  OK   ' + nome);
  else { falhas++; console.log('  FAIL ' + nome + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}
const espera = (ms = 150) => new Promise(r => setTimeout(r, ms));

const PORTA = 3990 + Math.floor(Math.random() * 9);
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rearme-p-'));
const base = `http://127.0.0.1:${PORTA}/`;

async function abrir(senha) {
  const html = await (await fetch(base)).text();
  let cookie = '';
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => console.log('  [jsdomError] ' + e.message));
  const dom = new JSDOM(html, {
    url: base, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.fetch = async (u, o = {}) => {
        const r = await fetch(new URL(u, base), { ...o, headers: { ...(o.headers || {}), ...(cookie ? { cookie } : {}) } });
        const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
        return r;
      };
      w.scrollTo = () => {};
      w.print = () => { w.__imprimiu = true; };
    }
  });
  const w = dom.window, doc = w.document;
  await espera(300);
  if (senha) {
    doc.getElementById('senha').value = senha;
    doc.getElementById('f-senha').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await espera(400);
  }
  return w;
}
const clicar = (doc, sel) => { const el = doc.querySelector(sel); if (!el) throw new Error('não achei ' + sel); el.click(); };
const linha = (doc, tipo) => doc.querySelector(`.it[data-tipo="${tipo}"]`);
const qtd = (doc, tipo) => linha(doc, tipo).querySelector('output').textContent;

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORTA), DADOS_DIR: DIR, SENHA: 'equipe1', SENHA_ADMIN: 'admin1', SENHA_CONSULTA: 'ver1' },
    stdio: ['ignore', 'pipe', 'inherit']
  });
  await new Promise(ok => srv.stdout.on('data', d => { if (/no ar/.test(d)) ok(); }));
  try {
    console.log('\n1. Entrar com a senha da equipe');
    let w = await abrir();
    let doc = w.document;
    check('pede senha', !!doc.getElementById('f-senha'));
    doc.getElementById('senha').value = 'errada';
    doc.getElementById('f-senha').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await espera(300);
    check('senha errada avisa', doc.getElementById('toast').textContent === 'Senha errada');
    w = await abrir('equipe1'); doc = w.document;
    check('entrou na lista de rearmes', /Rearmes/.test(doc.querySelector('h1').textContent));
    check('lista vazia', /Nenhum rearme/.test(doc.getElementById('app').textContent));

    console.log('\n2. Criar rearme');
    clicar(doc, '[data-a="novo"]');
    doc.getElementById('novo-nome').value = 'Mariah Carey';
    doc.getElementById('novo-data').value = '2026-11-15';
    doc.getElementById('f-novo').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await espera(400);
    check('abriu o rearme', doc.querySelector('h1').textContent === 'Mariah Carey');
    check('13 salas a conferir', doc.querySelectorAll('.sala.st-pendente').length === 13);

    console.log('\n3. Conferir C-05 (falta 1 bistrô e 2 banquetas)');
    clicar(doc, '.sala[data-id="c-05"]');
    check('começa no previsto', qtd(doc, 'banqueta') === '12');
    clicar(doc, '.it[data-tipo="mesa-bistro"] [data-a="menos"]');
    clicar(doc, '.it[data-tipo="banqueta"] [data-a="menos"]');
    clicar(doc, '.it[data-tipo="banqueta"] [data-a="menos"]');
    check('mostra "Faltam 2"', /Faltam 2/.test(linha(doc, 'banqueta').textContent));
    clicar(doc, '[data-a="salvar-conf"]');
    check('sem nome não salva', doc.getElementById('toast').textContent === 'Informe quem conferiu');
    doc.getElementById('conferente').value = 'Marcos';
    doc.getElementById('obs').value = 'Espelho ok';
    clicar(doc, '[data-a="salvar-conf"]');
    await espera(400);
    check('voltou ao rearme com C-05 em vermelho', !!doc.querySelector('.sala.st-divergente[data-id="c-05"]'));

    console.log('\n4. Conferir T-53 (sobra 1 bistrô) e C-02 (2 banquetas a mais)');
    clicar(doc, '.sala[data-id="t-53"]');
    check('nome de quem conferiu lembrado', doc.getElementById('conferente').value === 'Marcos');
    clicar(doc, '.it[data-tipo="mesa-bistro"] [data-a="mais"]');
    clicar(doc, '[data-a="salvar-conf"]');
    await espera(400);
    clicar(doc, '.sala[data-id="c-02"]');
    doc.getElementById('add-tipo').value = 'banqueta';
    clicar(doc, '[data-a="add-item"]');
    check('item a mais "Não é desta sala"', /Não é desta sala/.test(linha(doc, 'banqueta').textContent));
    clicar(doc, '.it[data-tipo="banqueta"] [data-a="mais"]');
    clicar(doc, '[data-a="salvar-conf"]');
    await espera(400);
    const lista = doc.getElementById('app').textContent;
    check('remaneja bistrô T-53 → C-05', /1 Mesa bistrô: T-53 → C-05/.test(lista), lista);
    check('banquetas da C-02 vão para a C-05', /2 Banqueta: C-02 → C-05/.test(lista));
    check('nada a buscar no depósito', !/Buscar no depósito/.test(lista));
    check('aviso das salas pendentes', /Ainda falta conferir/.test(lista));
    check('observação na lista', /Espelho ok/.test(lista));

    console.log('\n5. Marcar como rearmada');
    clicar(doc, '.sala[data-id="c-05"]');
    clicar(doc, '[data-a="marcar"]');
    await espera(400);
    check('C-05 rearmada', !!doc.querySelector('.sala.st-rearmada[data-id="c-05"]'));
    check('linha do remanejamento ainda aberta (T-53 não rearmada)', !!doc.querySelector('.blk li:not(.feito)'));

    console.log('\n6. Copiar e imprimir');
    w.navigator.clipboard = undefined;
    clicar(doc, '[data-a="copiar"]');
    check('texto para WhatsApp', /REARME DAS SALAS/.test(doc.getElementById('copia').value) && /Mariah Carey · 15\/11\/2026/.test(doc.getElementById('copia').value));
    clicar(doc, '[data-a="imprimir"]');
    check('imprimir chamado', w.__imprimiu === true);

    console.log('\n7. Equipe não edita o previsto');
    clicar(doc, '[data-a="go-salas"]');
    check('aba Salas mostra 13 salas', doc.querySelectorAll('[data-a="editar-sala"]').length === 0 && /13 salas, 136 peças/.test(doc.getElementById('app').textContent));

    console.log('\n8. Administrador cria a T-40 com item novo');
    w = await abrir('admin1'); doc = w.document;
    clicar(doc, '[data-a="go-salas"]');
    clicar(doc, '[data-a="nova-sala"]');
    doc.getElementById('ed-codigo').value = 'T-40';
    doc.getElementById('ed-nome').value = 'Sala de Produção T-40';
    doc.getElementById('ed-add').value = 'Cadeira azul';
    clicar(doc, '[data-a="ed-add"]');
    doc.getElementById('ed-add').value = 'Frigobar';
    clicar(doc, '[data-a="ed-add"]');
    clicar(doc, '.it[data-tipo="cadeira-azul"] [data-a="ed-mais"]');
    check('código digitado continua depois de clicar', doc.getElementById('ed-codigo').value === 'T-40');
    clicar(doc, '[data-a="ed-salvar"]');
    await espera(500);
    const arq = JSON.parse(fs.readFileSync(path.join(DIR, 'rearme.json'), 'utf8'));
    const t40 = arq.catalogo.salas.find(s => s.id === 't-40');
    check('T-40 gravada', t40 && t40.itens.length === 2 && t40.itens[0].qtd === 2, t40);
    check('Frigobar entrou na lista de itens', arq.catalogo.tipos.frigobar && arq.catalogo.tipos.frigobar.nome === 'Frigobar');
    check('aba Salas com 14', /14 salas/.test(doc.getElementById('app').textContent));

    console.log('\n9. Consulta (outro setor) só vê');
    w = await abrir('ver1'); doc = w.document;
    check('sem botão de novo rearme', !doc.querySelector('[data-a="novo"]'));
    clicar(doc, '[data-a="abrir-rearme"]');
    check('vê a lista de rearme', /Remanejar entre salas/.test(doc.getElementById('app').textContent));
    clicar(doc, '.sala[data-id="c-05"]');
    check('sala sem botões de − e +', !doc.querySelector('[data-a="menos"]') && !doc.querySelector('[data-a="salvar-conf"]'));
  } finally {
    srv.kill();
    fs.rmSync(DIR, { recursive: true, force: true });
  }
  console.log(falhas ? `\n${falhas} TESTE(S) FALHARAM` : '\nTODOS OS TESTES PASSARAM');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
