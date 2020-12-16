class ConfigurationError extends Error {
  constructor(configurationParameter) {
    const message = `Invalid configuration parameter: ${configurationParameter}`;
    super(message);
    this.code = 400;
  }
}

module.exports = {
  ConfigurationError,
};
