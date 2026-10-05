module.exports = function (RED) {
  function EudiploPresentationNode(config) {
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
          result = await server.client.createPresentationRequest({
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
  }

  RED.nodes.registerType('eudiplo-presentation', EudiploPresentationNode);
};
