// Node-RED replaces config values of the form ${VAR} with the env variable
// before the node is created. A value still in that form means the variable is not set.
const UNRESOLVED_ENV_VAR = /^\$\{\S+\}$/;

// Resolves base URL, client ID and client secret from an eudiplo-config node.
// Each value is either an env variable reference ('env') or a literal string ('str').
// The literal client secret is stored as an encrypted node credential.
function resolveConnectionSettings(node, config) {
  const credentials = node.credentials || {};

  function resolve(type, value, literal) {
    if (type === 'str') {
      return literal;
    }
    return UNRESOLVED_ENV_VAR.test(value) ? undefined : value;
  }

  return {
    baseUrl:      resolve(config.baseUrlType, config.baseUrl, config.baseUrl),
    clientId:     resolve(config.clientIdType, config.clientId, config.clientId),
    clientSecret: resolve(config.clientSecretType, config.clientSecretEnv, credentials.clientSecret),
  };
}

module.exports = { resolveConnectionSettings };
