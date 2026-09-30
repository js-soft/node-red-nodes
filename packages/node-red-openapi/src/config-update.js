// version === node version
const clientUpdate = (version, node) => {
  // adding new version bug (missing addCurrentNodeVersion)
  if (Array.isArray(node.headers)) {
    node.version = '2.1.2'
    version.aggregated = version.parse('2.1.2').aggregated
  }

  // lower than 2.0.0
  if (version.aggregated < version.parse('2.1.2').aggregated) {
    if (typeof node.urlType === 'undefined') node.urlType = 'str'
    if (typeof node.serverType === 'undefined') node.serverType = 'custom'
    if (typeof node.headers === 'undefined') node.headers = []
  }
  return node
}

module.exports = {
  clientUpdate
}
