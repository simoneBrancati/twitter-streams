const stream = require('stream');
const fetch = require('node-fetch');
const AbortController = require('abort-controller');
const log4js = require('log4js');
const { ConfigurationError } = require('./Error');

class TwitterStreams {
  constructor(bearerToken, url, config = {}) {
    // Validation
    this.constructor.__validateRequired(bearerToken, url);
    this.constructor.__validateConfig(config);

    // Required
    this._bearerToken = bearerToken;
    this._url = url;

    // Config
    this._timeout = config.timeout || this.constructor.__defaultTimeout();
    if (config.retry) {
      this._retry = true;
      this._base = config.retry.base;
      this._currentBackoff = this._base;
      this._customBackoff = config.retry.customBackoff
        || this.constructor.__defaultBackoffAlgorithm;
    }
    const logLevel = this.__getLogLevel();
    this._logger = log4js.getLogger();
    this._logger.level = logLevel;
  }

  static __validateRequired(bearerToken, url) {
    if (!bearerToken || typeof bearerToken !== 'string') {
      throw new ConfigurationError('bearer token');
    }
    if (!url || typeof url !== 'string') {
      throw new ConfigurationError('url');
    }
  }

  static __validateConfig(config) {
    if (config.timeout && typeof config.timeout !== 'number') {
      throw new ConfigurationError('timeout');
    }
    if (config.retry && !(config.retry instanceof Object)) {
      throw new ConfigurationError('retry');
    }
    if (config.retry && config.retry.base && typeof config.retry.base !== 'number') {
      throw new ConfigurationError('retry.base');
    }
    if (config.retry && config.retry.customBackoff
        && !(config.retry.customBackoff instanceof Function)) {
      throw new ConfigurationError('retry.customBackoff');
    }
  }

  get bearerToken() {
    return this._bearerToken;
  }

  set bearerToken(value) {
    this._bearerToken = value;
  }

  get url() {
    return this._url;
  }

  set url(value) {
    this._url = value;
  }

  get timeout() {
    return this._timeout;
  }

  set timeout(value) {
    this._timeout = value;
  }

  static __defaultTimeout() {
    return 20000;
  }

  get retry() {
    return this._retry;
  }

  get base() {
    return this._base;
  }

  get currentBackoff() {
    return this._currentBackoff;
  }

  set currentBackoff(value) {
    this._currentBackoff = value;
  }

  get customBackoff() {
    return this._customBackoff;
  }

  static __defaultBackoffAlgorithm(backoff) {
    return backoff ** 2;
  }

  increaseBackoff() {
    this.currentBackoff = this.customBackoff(this.currentBackoff);
  }

  resetBackoff() {
    this.currentBackoff = this.base;
  }

  get abortController() {
    return this._abortController;
  }

  refreshAbortController() {
    this._abortController = new AbortController();
  }

  get headers() {
    return { Authorization: `Bearer ${this.bearerToken}` };
  }

  get connectionOptions() {
    return {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.bearerToken}`,
      },
      signal: this.abortController.signal,
    };
  }

  get logger() {
    return this._logger;
  }

  static __defaultLevel() {
    return 'info';
  }

  __getLogLevel(level) {
    const validLevels = [
      'trace',
      'debug',
      'info',
      'warn',
      'error',
      'fatal',
    ];
    return validLevels.includes(level) ? level : this.constructor.__defaultLevel();
  }

  __startTimeout() {
    this.__connectionTimeout = setTimeout(() => {
      this.abortController.abort();
    }, this.timeout);
  }

  __clearTimeout() {
    clearTimeout(this.__connectionTimeout);
  }

  static __createStream() {
    return new stream.PassThrough();
  }

  static __streamPipe(src, dest) {
    src.pipe(dest);
    src.once('error', (error) => {
      dest.emit('error', error);
    });
  }

  static __sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  static __isJSON(string) {
    try {
      return JSON.parse(string);
    } catch (e) {
      return false;
    }
  }

  async createConnection() {
    this.logger.info('Creating connection with Twitter stream...');
    const twitterStream = this.constructor.__createStream();
    this.refreshAbortController();
    const response = await fetch(this.url, this.connectionOptions);
    this.constructor.__streamPipe(response.body, twitterStream);
    return twitterStream;
  }

  readStream(twitterStream, cb) {
    this.logger.info('Listening to Twitter stream...');
    // on data
    twitterStream.on('data', async (rawData) => {
      this.__clearTimeout();
      this.__startTimeout();
      let data;
      try {
        data = Buffer.from(rawData).toString();
      } catch (error) {
        this.logger.warn('Data received is not a buffer.');
        this.logger.debug({
          code: '500',
          title: 'REQUEST_ERROR',
          message: 'Data is not a buffer',
          data,
          error,
        });
        twitterStream.emit('timeout');
      }
      const json = this.constructor.__isJSON(data);
      if (!json) {
        // Keep alive received
        this.resetBackoff();
        this.logger.info('Keep-Alive signal received. Keep listening...');
      } else if (json.title === 'ConnectionException') {
        this.logger.warn('Connection Exception: Too many connections.');
        this.logger.debug({
          code: '429',
          title: 'CONNECTION_ERROR',
          message: 'Too Many Connections',
          error: json,
        });
        twitterStream.emit('timeout');
      } else {
        // Tweet received
        this.resetBackoff();
        this.logger.info('Tweet received!');
        this.logger.info(data);
        if (cb) {
          await cb(json);
        }
      }
    });

    twitterStream.on('error', (error) => {
      let debugMessage;
      if (error.name === 'AbortError') {
        this.logger.warn(`Timeout Error: Timeout of ${this.timeout} ms has been exceeded.`);
        debugMessage = {
          code: '408',
          title: 'TIMEOUT_ERROR',
          message: `Timeout of ${this.timeout} ms has been exceeded.`,
          error,
        };
        clearTimeout(this.timeout);
        twitterStream.emit('timeout');
      } else {
        this.logger.fatal(error.message);
        debugMessage = {
          code: '500',
          title: 'STREAM_ERROR',
          error,
        };
      }
      this.logger.debug(debugMessage);
    });

    twitterStream.on('timeout', async () => {
      if (this.retry) {
        this.logger.info('Connection Retry process started.');
        this.logger.info(`Waiting backoff time of ${this.currentBackoff} ms...`);
        await this.constructor.__sleep(this.currentBackoff);
        this.logger.info('Retrying connection...');
        const retryStream = await this.createConnection();
        this.increaseBackoff(this.customBackoff);
        await this.readStream(retryStream);
      }
    });
  }

  async createRules(hashtag) {
    const URL = 'https://api.twitter.com/2/tweets/search/stream/rules';
    const jsonBody = {
      add: [
        { value: `#${hashtag} -is:quote -is:retweet -is:reply`, tag: `#${hashtag}` },
      ],
    };
    const body = JSON.stringify(jsonBody);
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.bearerToken}`,
    };
    const result = await fetch(URL, { method: 'POST', body, headers });
    const response = await result.json();
    this.logger.info(`Rules created for hashtag #${hashtag}.`);
    this.logger.debug(response);
  }

  async getRules() {
    const URL = 'https://api.twitter.com/2/tweets/search/stream/rules';
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.bearerToken}`,
    };
    const result = await fetch(URL, { headers });
    const response = await result.json();

    return response;
  }

  async deleteRules(ids) {
    const URL = 'https://api.twitter.com/2/tweets/search/stream/rules';
    const jsonBody = {
      delete: {
        ids,
      },
    };
    const body = JSON.stringify(jsonBody);
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.bearerToken}`,
    };
    const result = await fetch(URL, { method: 'POST', body, headers });
    const response = await result.json();
    this.logger.info('Rules deleted.');
    this.logger.debug(response);
  }

  async overwriteRules(hashtag) {
    const rules = await this.getRules();
    this.logger.debug(`Rules to overwrite: ${rules}.`);
    try {
      const ids = rules.data.map((item) => item.id);
      await this.deleteRules(ids);
    } catch (error) {
      this.logger.fatal(error);
    }
    await this.createRules(hashtag);
  }
}

exports.TwitterStreams = TwitterStreams;
