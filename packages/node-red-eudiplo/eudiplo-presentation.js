const { EudiploClient } = require('@eudiplo/sdk-core');

const BASE_URL_ENV_VAR = 'EUDIPLO_BASE_URL';

module.exports = function (RED) {
  function EudiploPresentationNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    let clientId = process.env.EUDIPLO_CLIENT_ID;
    let clientSecret = process.env.EUDIPLO_CLIENT_SECRET;

    if (config.credentialsOverwrite) {
      clientId = config.clientId;
      clientSecret = node.credentials.clientSecret;
      node.log('Overwriting eudiplo-credentials from environment variables ');
    } else {
      node.log('Using eudiplo-credentials from environment variables');
    }

    const baseUrl = config.baseUrlOverwrite ? config.baseUrl : process.env[BASE_URL_ENV_VAR];

    if (config.baseUrlOverwrite) {
      node.log('Overwriting eudiplo base URL from node configuration');
    } else {
      node.log(`Using eudiplo base URL from environment variable ${BASE_URL_ENV_VAR}`);
    }

    let configurationError = null;
    if (!baseUrl) {
      configurationError = `Missing Eudiplo base URL. Set ${BASE_URL_ENV_VAR} or enable the Base URL override in the node configuration.`;
      node.status({ fill: 'red', shape: 'ring', text: 'missing base URL' });
      node.error(configurationError);
    }

    // EudiploClient handles token acquisition and refresh internally.
    // The SDK uses ${baseUrl}/oauth2/token as the token endpoint.
    let sdkClient = null;
    if (!configurationError) {
      sdkClient = new EudiploClient({
        baseUrl,
        clientId: clientId,
        clientSecret: clientSecret,
      });
    }

    node.on('input', async function (msg, send, done) {
      if (configurationError) {
        node.status({ fill: 'red', shape: 'ring', text: 'missing base URL' });
        return done(new Error(configurationError));
      }

      try {
        // ── Resolve presentation config ID ───────────────────────────────
        const configId =
          config.presentationConfigIdSource === 'msg'
            ? RED.util.getMessageProperty(msg, config.presentationConfigId)
            : config.presentationConfigId;

        if (!configId) {
          return done(new Error('Presentation Config ID is empty'));
        }

        node.status({ fill: 'blue', shape: 'dot', text: 'requesting…' });
        let result;
        try {
          result = await sdkClient.createPresentationRequest({
            configId,
            responseType: 'uri',
          });
        } catch (error) {
          msg.payload.eudiploSuccess = false;
          send(msg);
          return done(error);
        }

        node.log('Presentation result: ' + JSON.stringify(result));

        if (!msg.payload || typeof msg.payload !== 'object') {
          msg.payload = {};
        }
        msg.payload.presentationUri = result.uri;
        msg.payload.crossDeviceUri = result.crossDeviceUri;
        msg.payload.sessionId = result.sessionId;
        msg.payload.eudiploSuccess = true;
        node.status({});
        send(msg);
        done();
      } catch (err) {
        node.status({ fill: 'red', shape: 'ring', text: err.message });
        done(err);
      }
    });

    node.on('close', function () {
      sdkClient = null;
    });
  }

  RED.nodes.registerType('eudiplo-presentation', EudiploPresentationNode, {
    credentials: {
      clientSecret: { type: 'password' },
    },
  });
};
