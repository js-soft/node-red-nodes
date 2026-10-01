const { Blob: BufferBlob, File: BufferFile } = require('node:buffer')

const MultipartFile = globalThis.File || BufferFile

const isNativeFileOrBlob = (value) => {
  if (value instanceof MultipartFile || value instanceof BufferBlob) {
    return true
  }
  if (typeof globalThis.File !== 'undefined' && value instanceof globalThis.File) {
    return true
  }
  return typeof globalThis.Blob !== 'undefined' && value instanceof globalThis.Blob
}

const getFileData = (value) => value.buffer ?? value.data
const getFileName = (value) => value.originalname ?? value.filename ?? value.name
const getContentType = (value) => value.mimetype ?? value.contentType ?? value.type

const findUploadForData = (data, uploads) => {
  if (!data || !uploads || typeof uploads !== 'object') {
    return null
  }

  const values = Array.isArray(uploads) ? uploads : Object.values(uploads)
  const candidates = values.flatMap(value => Array.isArray(value) ? value : [value])
    .filter(upload => upload && typeof upload === 'object')
  const exactMatch = candidates.find(upload => upload.buffer === data)

  if (exactMatch) {
    return exactMatch
  }

  return candidates.find(upload => (
    Buffer.isBuffer(upload.buffer) && Buffer.isBuffer(data) && upload.buffer.equals(data)
  )) || null
}

const createMultipartFile = (value) => {
  if (!value || typeof value !== 'object' || isNativeFileOrBlob(value)) {
    return null
  }

  const data = getFileData(value)
  const filename = getFileName(value)
  const isBinaryData = Buffer.isBuffer(data) || ArrayBuffer.isView(data) || data instanceof ArrayBuffer

  if (!isBinaryData || typeof filename !== 'string' || !filename) {
    return null
  }

  const contentType = getContentType(value)
  const options = typeof contentType === 'string' && contentType
    ? { type: contentType }
    : undefined

  return new MultipartFile([data], filename, options)
}

const normalizeMultipartFiles = (value, uploads) => {
  const file = createMultipartFile(value)
  if (file) {
    return file
  }

  const matchingUpload = findUploadForData(value, uploads)
  if (matchingUpload) {
    return createMultipartFile(matchingUpload)
  }

  if (Array.isArray(value)) {
    return value.map(nestedValue => normalizeMultipartFiles(nestedValue, uploads))
  }

  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, normalizeMultipartFiles(nestedValue, uploads)])
    )
  }

  return value
}

module.exports = {
  createMultipartFile,
  findUploadForData,
  normalizeMultipartFiles
}
