const crypto = require('crypto');

function generateExecutionId() {
  return `exec_${crypto.randomBytes(8).toString('hex')}_${Date.now()}`;
}

module.exports = { generateExecutionId };
