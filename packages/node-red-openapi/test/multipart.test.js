const test = require('node:test')
const assert = require('node:assert/strict')
const { File } = require('node:buffer')

const { createMultipartFile, normalizeMultipartFiles } = require('../src/utils/multipart')

test('converts a multer-style upload into a named File', async () => {
  const upload = {
    buffer: Buffer.from('document contents'),
    originalname: 'application.pdf',
    mimetype: 'application/pdf'
  }

  const file = createMultipartFile(upload)

  assert.ok(file instanceof File)
  assert.equal(file.name, 'application.pdf')
  assert.equal(file.type, 'application/pdf')
  assert.equal(Buffer.from(await file.arrayBuffer()).toString(), 'document contents')

  const formData = new FormData()
  formData.append('file', file)
  assert.equal(formData.get('file').name, 'application.pdf')
})

test('converts explicit file descriptors in nested multipart bodies', () => {
  const requestBody = {
    description: 'supporting document',
    attachments: [{
      buffer: Buffer.from('attachment'),
      filename: 'attachment.txt',
      contentType: 'text/plain'
    }]
  }

  const normalized = normalizeMultipartFiles(requestBody)

  assert.equal(normalized.description, 'supporting document')
  assert.ok(normalized.attachments[0] instanceof File)
  assert.equal(normalized.attachments[0].name, 'attachment.txt')
  assert.equal(normalized.attachments[0].type, 'text/plain')
})

test('restores metadata for a raw buffer from the incoming upload collection', () => {
  const buffer = Buffer.from('uploaded document')
  const uploads = {
    application: {
      buffer,
      originalname: 'application.pdf',
      mimetype: 'application/pdf'
    }
  }

  const normalized = normalizeMultipartFiles({ file: buffer }, uploads)

  assert.ok(normalized.file instanceof File)
  assert.equal(normalized.file.name, 'application.pdf')
  assert.equal(normalized.file.type, 'application/pdf')
})

test('prefers an identical buffer when multiple uploads have equal contents', () => {
  const buffer = Buffer.from('same contents')
  const uploads = [
    { buffer: Buffer.from('same contents'), originalname: 'wrong.pdf' },
    { buffer, originalname: 'correct.pdf' }
  ]

  const normalized = normalizeMultipartFiles({ file: buffer }, uploads)

  assert.equal(normalized.file.name, 'correct.pdf')
})

test('keeps raw buffers and existing File instances unchanged', () => {
  const buffer = Buffer.from('raw data')
  const file = new File([buffer], 'existing.bin')

  assert.equal(normalizeMultipartFiles(buffer), buffer)
  assert.equal(normalizeMultipartFiles(file), file)
})
