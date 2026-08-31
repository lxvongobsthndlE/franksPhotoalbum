// Winziger Statik-Server auf den public-Ordner EINES Zweiges. Zweck: die Seite
// ueber echtes HTTP ausliefern, damit Meta-Viewport, Stylesheet-Reihenfolge,
// Manifest und Origin genau so greifen wie live — file:// tut das nicht.
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(process.argv[2]), PORT = Number(process.argv[3] || 4321);
const TYP = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8',
  '.png':'image/png', '.svg':'image/svg+xml', '.webp':'image/webp', '.ico':'image/x-icon' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const datei = path.join(ROOT, p);
  if (!datei.startsWith(ROOT) || !fs.existsSync(datei) || fs.statSync(datei).isDirectory()) {
    res.writeHead(404); return res.end('nicht da');
  }
  res.writeHead(200, { 'content-type': TYP[path.extname(datei)] || 'application/octet-stream' });
  fs.createReadStream(datei).pipe(res);
}).listen(PORT, () => console.log('Statik-Server auf http://127.0.0.1:' + PORT + ' fuer ' + ROOT));
