const { EudiploClient } = require('@eudiplo/sdk-core');
const { resolveConnectionSettings } = require('./eudiplo-settings');

module.exports = function (RED) {
  function EudiploConfigNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    const { baseUrl, clientId, clientSecret } = resolveConnectionSettings(node, config);
    node.log(`Eudiplo settings: base URL from ${config.baseUrlType}, client ID from ${config.clientIdType}, client secret from ${config.clientSecretType}`);

    node.configurationError = null;
    node.client = null;
    if (!baseUrl) {
      node.configurationError = 'Missing Eudiplo base URL. Set the configured env variable or enter a base URL in the eudiplo config node.';
      node.error(node.configurationError);
    } else {
      // EudiploClient handles token acquisition and refresh internally, so all
      // nodes sharing this config node also share one cached access token.
      // The SDK uses ${baseUrl}/api/oauth2/token as the token endpoint.
      node.client = new EudiploClient({
        baseUrl,
        clientId,
        clientSecret,
      });
    }

    node.on('close', function () {
      node.client = null;
    });
  }

  RED.nodes.registerType('eudiplo-config', EudiploConfigNode, {
    credentials: {
      clientSecret: { type: 'password' },
    },
  });
};
