module.exports = function (RED) {
  function EudiploIssuanceNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    const server = RED.nodes.getNode(config.server);

    let configurationError = null;
    if (!server) {
      configurationError = 'Missing eudiplo config node. Select a server in the node configuration.';
    } else if (server.configurationError) {
      configurationError = server.configurationError;
    }
    if (configurationError) {
      node.status({ fill: 'red', shape: 'ring', text: 'invalid configuration' });
      node.error(configurationError);
    }

    node.on('input', async function (msg, send, done) {
      if (configurationError) {
        node.status({ fill: 'red', shape: 'ring', text: 'invalid configuration' });
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

        const result = await server.client.createIssuanceOffer({
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
  }

  RED.nodes.registerType('eudiplo-issuance', EudiploIssuanceNode);
};
