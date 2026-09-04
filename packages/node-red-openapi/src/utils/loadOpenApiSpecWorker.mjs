import https from 'https'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { parse } from 'yaml'
import fetch from 'node-fetch'

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
    if (source.toLowerCase().endsWith('.yaml') || source.toLowerCase().endsWith('.yml')) {
      spec = await parse(await response.text())
    } else {
      spec = await response.json()
    }
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
