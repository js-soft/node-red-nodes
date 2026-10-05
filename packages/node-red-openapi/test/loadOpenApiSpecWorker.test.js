const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')

const loadWorker = () => import('../src/utils/loadOpenApiSpecWorker.mjs')

const jsonSpec = JSON.stringify({ openapi: '3.0.0', info: { title: 'json' }, paths: {} })
const yamlSpec = 'openapi: 3.0.0\ninfo:\n  title: yaml\npaths: {}\n'

const routes = {
  '/spec.json': [200, 'application/json', jsonSpec],
  '/v3/api-docs': [200, 'application/vnd.oai.openapi', yamlSpec],
  '/openapi': [200, 'application/yaml', yamlSpec],
  '/spec.yaml': [200, 'text/plain', yamlSpec],
  '/missing': [404, 'application/json', '{"error":"not found"}'],
  '/down': [503, 'text/html', '<html>Service Unavailable</html>'],
  '/html': [200, 'text/html', '<html><body>login</body></html>']
}

let server
let baseUrl

test.before(async () => {
  server = http.createServer((req, res) => {
    const [status, type, body] = routes[new URL(req.url, 'http://x').pathname] || [500, 'text/plain', '']
    res.writeHead(status, { 'content-type': type })
    res.end(body)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

test.after(() => server.close())

test('loads json spec from url', async () => {
  const { default: load } = await loadWorker()
  const spec = await load({ source: baseUrl + '/spec.json' })
  assert.equal(spec.info.title, 'json')
})

test('loads yaml spec from url without extension via fallback', async () => {
  const { default: load } = await loadWorker()
  const spec = await load({ source: baseUrl + '/v3/api-docs' })
  assert.equal(spec.info.title, 'yaml')
})

test('loads yaml spec detected by content type', async () => {
  const { default: load } = await loadWorker()
  const spec = await load({ source: baseUrl + '/openapi' })
  assert.equal(spec.info.title, 'yaml')
})

test('loads yaml spec with extension followed by a query string', async () => {
  const { default: load } = await loadWorker()
  const spec = await load({ source: baseUrl + '/spec.yaml?version=2' })
  assert.equal(spec.info.title, 'yaml')
})

test('rejects non-2xx responses with the http status', async () => {
  const { default: load } = await loadWorker()
  await assert.rejects(load({ source: baseUrl + '/missing' }), (e) => e.status === 404 && /HTTP 404/.test(e.message))
  await assert.rejects(load({ source: baseUrl + '/down' }), (e) => e.status === 503 && /HTTP 503/.test(e.message))
})

test('rejects responses that are not a specification', async () => {
  const { default: load } = await loadWorker()
  await assert.rejects(load({ source: baseUrl + '/html' }), /not an OpenAPI specification/)
})
