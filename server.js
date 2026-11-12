// Servidor do Salas em Ordem (Farmasi Arena): conferência das salas depois de cada evento.
// Sem dependências: Node 20 puro. Os dados ficam em um arquivo JSON na pasta DADOS_DIR,
// que no Coolify deve ser um volume persistente.
//
// Três senhas (variáveis de ambiente):
//   SENHA_ADMIN    administrador: tudo, inclusive editar o previsto das salas e apagar checagens
//   SENHA          equipe: cria checagens, confere salas, marca sala em ordem
//   SENHA_CONSULTA consulta (outro setor): só vê
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORTA = Number(process.env.PORT || 3000);
const DADOS_DIR = process.env.DADOS_DIR || path.join(__dirname, 'dados');
const ARQ = path.join(DADOS_DIR, 'rearme.json');
const SENHA = process.env.SENHA || '';
const SENHA_ADMIN = process.env.SENHA_ADMIN || '';
const SENHA_CONSULTA = process.env.SENHA_CONSULTA || '';
const LIMITE_CORPO = 512 * 1024;
const ID = /^[a-z0-9][a-z0-9-]{0,59}$/;

// ---------- dados ----------
fs.mkdirSync(DADOS_DIR, { recursive: true });
function carregar() {
  if (fs.existsSync(ARQ)) return JSON.parse(fs.readFileSync(ARQ, 'utf8'));
  const inicial = path.join(__dirname, 'inicial.json');
  console.log('Banco novo criado a partir de', fs.existsSync(inicial) ? 'inicial.json' : 'zero');
  return fs.existsSync(inicial) ? JSON.parse(fs.readFileSync(inicial, 'utf8')) : { catalogo: { tipos: {}, salas: [] }, rearmes: {} };
}
let dados = carregar();
dados.catalogo = dados.catalogo || { tipos: {}, salas: [] };
dados.rearmes = dados.rearmes || {};
let versao = Date.now();
salvar();

function salvar() {
  const tmp = ARQ + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(dados));
  fs.renameSync(tmp, ARQ);
  copiaDoDia();
}
// Uma cópia por dia, guardando as últimas 30
function copiaDoDia() {
  const dir = path.join(DADOS_DIR, 'copias');
  fs.mkdirSync(dir, { recursive: true });
  const nome = path.join(dir, `rearme-${new Date().toISOString().slice(0, 10)}.json`);
  if (fs.existsSync(nome)) return;
  fs.copyFileSync(ARQ, nome);
  fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().slice(0, -30).forEach(f => fs.unlinkSync(path.join(dir, f)));
}

// ---------- ao vivo ----------
const ouvintes = new Set();
function mudou() {
  salvar();
  versao = Date.now();
  for (const res of ouvintes) res.write(`data: ${versao}\n\n`);
}
setInterval(() => { for (const res of ouvintes) res.write(': ping\n\n'); }, 25000);

// ---------- senhas ----------
const PAPEIS = [['admin', SENHA_ADMIN], ['equipe', SENHA], ['consulta', SENHA_CONSULTA]];
const fichaDe = (senha, papel) => crypto.createHmac('sha256', senha).update('rearme-' + papel).digest('hex');
const fichas = PAPEIS.filter(([, s]) => s).map(([papel, s]) => [papel, fichaDe(s, papel)]);
const NIVEL = { consulta: 1, equipe: 2, admin: 3 };
const tentativas = new Map();
function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function igual(a, b) { return !!a && !!b && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
function papelDe(req) {
  if (!fichas.length) return 'admin'; // sem nenhuma senha configurada (só no computador)
  const c = cookies(req).rs_sessao || '';
  const f = fichas.find(([, ficha]) => igual(c, ficha));
  return f ? f[0] : null;
}
function ipDe(req) { return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress; }
function bloqueado(ip) {
  const agora = Date.now(), t = (tentativas.get(ip) || []).filter(x => agora - x < 10 * 60000);
  tentativas.set(ip, t);
  return t.length >= 10;
}

// ---------- validação ----------
const texto = (v, max, obrigatorio) => typeof v === 'string' && v.length <= max && (!obrigatorio || v.trim().length > 0);
const qtd = v => Number.isInteger(v) && v >= 0 && v <= 999;

function validarCatalogo(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return 'Catálogo inválido';
  if (!c.tipos || typeof c.tipos !== 'object' || Array.isArray(c.tipos)) return 'Lista de itens inválida';
  const tipos = Object.entries(c.tipos);
  if (tipos.length > 500) return 'Itens demais';
  for (const [id, t] of tipos) {
    if (!ID.test(id) || !t || t.id !== id || !texto(t.nome, 80, true)) return 'Item inválido: ' + id;
  }
  if (!Array.isArray(c.salas) || c.salas.length > 200) return 'Lista de salas inválida';
  const ids = new Set();
  for (const s of c.salas) {
    if (!s || !ID.test(s.id || '') || ids.has(s.id)) return 'Sala inválida';
    ids.add(s.id);
    if (!texto(s.codigo, 20, true) || !texto(s.nome, 80, true) || (s.grupo !== undefined && !texto(s.grupo, 40))) return 'Sala inválida: ' + s.id;
    if (!Array.isArray(s.itens) || s.itens.length > 100) return 'Itens da sala inválidos: ' + s.codigo;
    const vistos = new Set();
    for (const i of s.itens) {
      if (!i || !c.tipos[i.tipoId] || vistos.has(i.tipoId) || !qtd(i.qtd) || i.qtd < 1) return 'Item da sala inválido: ' + s.codigo;
      vistos.add(i.tipoId);
    }
  }
  if (c.origem !== undefined && !texto(c.origem, 200)) return 'Origem inválida';
  return null;
}

function validarRegistro(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return 'Conferência inválida';
  const permitidos = new Set(['contagem', 'obs', 'conferidaEm', 'conferidaPor', 'rearmadaEm']);
  for (const k of Object.keys(r)) if (!permitidos.has(k)) return 'Campo não aceito: ' + k;
  if (!r.contagem || typeof r.contagem !== 'object' || Array.isArray(r.contagem)) return 'Contagem inválida';
  const itens = Object.entries(r.contagem);
  if (itens.length > 200) return 'Contagem inválida';
  for (const [id, v] of itens) if (!dados.catalogo.tipos[id] || !qtd(v)) return 'Contagem inválida: ' + id;
  if (!texto(r.conferidaPor, 80, true)) return 'Informe quem conferiu';
  if (!texto(r.conferidaEm, 40, true)) return 'Data da conferência inválida';
  if (r.obs !== undefined && !texto(r.obs, 1000)) return 'Observação longa demais';
  if (r.rearmadaEm !== undefined && r.rearmadaEm !== null && !texto(r.rearmadaEm, 40, true)) return 'Data de "em ordem" inválida';
  return null;
}

// ---------- http ----------
function json(res, status, corpo) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(corpo === undefined ? '' : JSON.stringify(corpo));
}
function lerCorpo(req) {
  return new Promise((ok, falha) => {
    let tam = 0; const partes = [];
    req.on('data', p => { tam += p.length; if (tam > LIMITE_CORPO) { falha({ status: 413 }); req.destroy(); } else partes.push(p); });
    req.on('end', () => { try { ok(partes.length ? JSON.parse(Buffer.concat(partes).toString('utf8')) : null); } catch { falha({ status: 400 }); } });
    req.on('error', () => falha({ status: 400 }));
  });
}

const PAGINA = path.join(__dirname, 'public', 'pagina.html');
function servirPagina(res) {
  const corpo = fs.readFileSync(PAGINA, 'utf8');
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
  res.end('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    + '<meta name="theme-color" content="#a10f12"><link rel="icon" href="logo_gl.png">'
    + '<style>body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>'
    + '</head><body>' + corpo + '</body></html>');
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/' || p === '/index.html') return servirPagina(res);
    if (p === '/logo_gl.png') {
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
      return fs.createReadStream(path.join(__dirname, 'public', 'logo_gl.png')).pipe(res);
    }
    if (p === '/api/health') return json(res, 200, { ok: true, salas: dados.catalogo.salas.length, rearmes: Object.keys(dados.rearmes).length });

    if (p === '/api/entrar' && req.method === 'POST') {
      const ip = ipDe(req);
      if (bloqueado(ip)) return json(res, 429, { erro: 'Muitas tentativas. Espere 10 minutos.' });
      const corpo = await lerCorpo(req);
      const senha = corpo && typeof corpo.senha === 'string' ? corpo.senha : '';
      const achou = PAPEIS.find(([, s]) => s && senha === s);
      if (achou) {
        const ficha = fichas.find(([papel]) => papel === achou[0])[1];
        const seguro = (req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
        res.setHeader('set-cookie', `rs_sessao=${ficha}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${180 * 86400}${seguro}`);
        return json(res, 200, { ok: true, papel: achou[0] });
      }
      tentativas.get(ip).push(Date.now());
      return json(res, 401, { erro: 'Senha errada' });
    }
    if (p === '/api/sair' && req.method === 'POST') {
      res.setHeader('set-cookie', 'rs_sessao=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
      return json(res, 200, { ok: true });
    }

    const papel = papelDe(req);
    if (p.startsWith('/api/') && !papel) return json(res, 401, { erro: 'Entre com a senha' });
    const pode = (min) => NIVEL[papel] >= NIVEL[min];
    const negar = (min) => json(res, 403, { erro: min === 'admin' ? 'Só o administrador pode fazer isso' : 'Esta senha é só para consulta' });

    if (p === '/api/dados' && req.method === 'GET') return json(res, 200, { ...dados, versao, papel });

    if (p === '/api/eventos') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write(`data: ${versao}\n\n`);
      ouvintes.add(res);
      req.on('close', () => ouvintes.delete(res));
      return;
    }

    // Previsto das salas (catálogo): só administrador
    if (p === '/api/catalogo' && req.method === 'PUT') {
      if (!pode('admin')) return negar('admin');
      const corpo = await lerCorpo(req);
      const erro = validarCatalogo(corpo);
      if (erro) return json(res, 400, { erro });
      dados.catalogo = corpo;
      mudou();
      return json(res, 204);
    }

    // Criar um rearme (um por evento): equipe ou administrador
    if (p === '/api/rearmes' && req.method === 'POST') {
      if (!pode('equipe')) return negar('equipe');
      const corpo = await lerCorpo(req);
      if (!corpo || !texto(corpo.nome, 120, true) || (corpo.data !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(corpo.data))) return json(res, 400, { erro: 'Informe o nome do evento' });
      const id = 'r' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
      dados.rearmes[id] = { id, nome: corpo.nome.trim(), data: corpo.data || '', criadoEm: Date.now(), salas: {} };
      mudou();
      return json(res, 200, { id });
    }

    const mr = p.match(/^\/api\/rearmes\/(r[a-z0-9]{1,40})$/);
    if (mr) {
      const r = dados.rearmes[mr[1]];
      if (!r) return json(res, 404, { erro: 'Checagem não encontrada' });
      if (req.method === 'DELETE') {
        if (!pode('admin')) return negar('admin');
        delete dados.rearmes[mr[1]];
        mudou();
        return json(res, 204);
      }
      if (req.method === 'PATCH') {
        if (!pode('admin')) return negar('admin');
        const corpo = await lerCorpo(req);
        if (!corpo || typeof corpo !== 'object') return json(res, 400, { erro: 'Pedido inválido' });
        if (corpo.nome !== undefined) { if (!texto(corpo.nome, 120, true)) return json(res, 400, { erro: 'Nome inválido' }); r.nome = corpo.nome.trim(); }
        if (corpo.data !== undefined) { if (corpo.data !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(corpo.data)) return json(res, 400, { erro: 'Data inválida' }); r.data = corpo.data; }
        mudou();
        return json(res, 204);
      }
      return json(res, 405, { erro: 'Método não aceito' });
    }

    // Conferência de uma sala: substitui o registro inteiro (ou apaga)
    const ms = p.match(/^\/api\/rearmes\/(r[a-z0-9]{1,40})\/salas\/([a-z0-9][a-z0-9-]{0,59})$/);
    if (ms) {
      if (!pode('equipe')) return negar('equipe');
      const r = dados.rearmes[ms[1]];
      if (!r) return json(res, 404, { erro: 'Checagem não encontrada' });
      if (!dados.catalogo.salas.some(s => s.id === ms[2])) return json(res, 404, { erro: 'Sala não encontrada' });
      r.salas = r.salas || {};
      if (req.method === 'DELETE') {
        delete r.salas[ms[2]];
        mudou();
        return json(res, 204);
      }
      if (req.method === 'PUT') {
        const corpo = await lerCorpo(req);
        const erro = validarRegistro(corpo);
        if (erro) return json(res, 400, { erro });
        if (!corpo.rearmadaEm) delete corpo.rearmadaEm;
        r.salas[ms[2]] = corpo;
        mudou();
        return json(res, 204);
      }
      return json(res, 405, { erro: 'Método não aceito' });
    }

    json(res, 404, { erro: 'Não encontrado' });
  } catch (e) {
    if (e && e.status) return json(res, e.status, { erro: 'Pedido inválido' });
    console.error(e);
    json(res, 500, { erro: 'Erro interno' });
  }
});

servidor.listen(PORTA, () => console.log(`Salas em Ordem no ar na porta ${PORTA} · senhas: administrador ${SENHA_ADMIN ? 'sim' : 'NÃO'}, equipe ${SENHA ? 'sim' : 'NÃO'}, consulta ${SENHA_CONSULTA ? 'sim' : 'NÃO'}`));
