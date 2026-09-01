const { EudiploClient } = require('@eudiplo/sdk-core');

const BASE_URL_ENV_VAR = 'EUDIPLO_BASE_URL';

module.exports = function (RED) {
  function EudiploIssuanceNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    let clientId = process.env.EUDIPLO_CLIENT_ID;
    let password = process.env.EUDIPLO_CLIENT_SECRET;

    if (config.credentialsOverwrite) {
      node.log('Overwriting eudiplo-credentials from environment variables');
      clientId = config.clientId;
      password = node.credentials.clientSecret;
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
        clientSecret: password
      });
    }

    node.on('input', async function (msg, send, done) {
      if (configurationError) {
        node.status({ fill: 'red', shape: 'ring', text: 'missing base URL' });
        return done(new Error(configurationError));
      }

      try {
        // ── Resolve credentialConfigurationIds ──────────────────────────
        const rawId =
          config.credentialConfigurationIdSource === 'msg'
            ? RED.util.getMessageProperty(msg, config.credentialConfigurationId)
            : config.credentialConfigurationId;

        if (!rawId) {
          return done(new Error('Credential Configuration ID is empty'));
        }
        const credentialConfigurationIds = Array.isArray(rawId) ? rawId : [rawId];

        // ── Resolve subject data / claims ──────────────────────────────
        let subjectData;
        if (config.subjectDataSource === 'msg') {
          subjectData = RED.util.getMessageProperty(msg, config.subjectData);
        } else {
          try {
            subjectData = JSON.parse(config.subjectData || '{}');
          } catch {
            subjectData = {};
          }
        }

        let claims;
        if (subjectData && Object.keys(subjectData).length > 0) {
          claims = { [credentialConfigurationIds[0]]: subjectData };
        }

        node.status({ fill: 'blue', shape: 'dot', text: 'issuing…' });

        const result = await sdkClient.createIssuanceOffer({
          credentialConfigurationIds,
          claims,
          flow: config.flow || 'pre_authorized_code',
          responseType: config.responseType || 'uri',
        });

        node.log('Issuance result: ' + JSON.stringify(result));

        if (!msg.payload || typeof msg.payload !== 'object') {
          msg.payload = {};
        }
        msg.payload.credentialOffer = result.uri;
        msg.payload.sessionId = result.sessionId;
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

  RED.nodes.registerType('eudiplo-issuance', EudiploIssuanceNode, {
    credentials: {
      clientSecret: { type: 'password' },
    },
  });
};
