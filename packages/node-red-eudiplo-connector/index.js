module.exports = function(RED) {
  require('./eudiplo-config')(RED);
  require('./eudiplo-issuance')(RED);
  require('./eudiplo-presentation')(RED);
};
