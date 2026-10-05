import https from 'https'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { parse } from 'yaml'
import fetch from 'node-fetch'

const isYamlPath = (path) => /\.ya?ml$/i.test(path)

// remote specs are detected by content type or file extension (ignoring query/hash), else json with yaml as fallback
export function parseRemoteSpec (text, source, contentType = '') {
  let pathname = source
  try {
    pathname = new URL(source).pathname
  } catch (e) {}
  const yamlHinted = /yaml/i.test(contentType || '') || isYamlPath(pathname)

  let spec
  try {
    spec = yamlHinted ? parse(text) : JSON.parse(text)
  } catch (jsonError) {
    try {
      spec = parse(text)
    } catch (yamlError) {
      throw new Error(`[openAPI-red] Specification from ${source} is neither valid JSON nor YAML: ${jsonError.message}`)
    }
  }
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error(`[openAPI-red] Response from ${source} is not an OpenAPI specification (content type: ${contentType || 'unknown'}).`)
  }
  return spec
}

export default async function (options) {
  let spec
  const source = options.source
  if (source.startsWith('http') || source.startsWith('ws')) {
    let response
    // dev mode or localhost can handle self signed signatures
    if (source.startsWith('https://localhost:') || source.startsWith('https://localhost/') || options.devMode) {
      const agent = new https.Agent({ rejectUnauthorized: false })
      response = await fetch(source, { agent })
    } else {
      response = await fetch(source)
    }
    if (!response.ok) {
      const error = new Error(`[openAPI-red] Fetching specification from ${source} failed with HTTP ${response.status}${response.statusText ? ' ' + response.statusText : ''}.`)
      error.status = response.status
      throw error
    }
    spec = parseRemoteSpec(await response.text(), source, response.headers.get('content-type'))
  } else {
    // check if it is a local file
    // swaggerjs expects and can only handle a POJO if its a file, a http call can be json or yaml
    if (source.toLowerCase().endsWith('.yaml') || source.toLowerCase().endsWith('.yml')) {
      let fileData
      if (existsSync(source + '.json') && !options.reload) {
        fileData = readFileSync(source + '.json', 'utf-8')
        spec = JSON.parse(fileData)
      } else {
        // file does not exist or reload button was used
        fileData = readFileSync(source, 'utf-8')
        spec = parse(fileData)
        writeFileSync(source + '.json', JSON.stringify(spec), 'utf-8')
      }
    } else {
      const fileData = readFileSync(source, 'utf-8')
      spec = JSON.parse(fileData)
    }
  }
  return spec
}
