const stream = require('stream');
const fetch = require('node-fetch');
const AbortController = require('abort-controller');
const { ConfigurationError } = require('./Error');

class TwitterStreams {
  constructor(bearerToken, config = {}) {
    // Validation
    this.constructor.__validateRequired(bearerToken);
    this.constructor.__validateConfig(config);

    // Required
    this._bearerToken = bearerToken;

    // Config
    this._timeout = config.timeout || this.constructor.__defaultTimeout;
    if (config.retry) {
      this._retry = true;
      this._base = config.retry.base;
      this._currentBackoff = this._base;
      this._customBackoff = config.retry.customBackoff
        || this.constructor.__defaultBackoffAlgorithm;
    }

    this._abortController = new AbortController();
  }

  static __validateRequired(bearerToken) {
    if (!bearerToken || typeof bearerToken !== 'string') {
      throw new ConfigurationError('bearer token');
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

  async createConnection(url) {
    const response = await fetch(url, this.connectionOptions);
    const twitterStream = this.constructor.__createStream();
    this.constructor.__streamPipe(response.body, twitterStream);
    return twitterStream;
  }

  readStream(twitterStream, cb) {
    // on data
    twitterStream.on('data', async (rawData) => {
      this.__clearTimeout();
      this.__startTimeout();
      let data;
      try {
        data = Buffer.from(rawData).toString();
      } catch (error) {
        console.error({
          code: '500',
          title: 'REQUEST_ERROR',
          message: 'Data is not a buffer',
          data,
        });
        twitterStream.emit('timeout');
      }
      const json = this.constructor.__isJSON(data);
      if (!json) {
        // Keep alive received
        console.log({
          code: '200',
          data: 'KEEP_ALIVE',
        });
        this.resetBackoff();
      } else if (json.title === 'ConnectionException') {
        console.error({
          code: '429',
          title: 'CONNECTION_ERROR',
          message: 'Too Many Connections',
          data: json,
        });
        twitterStream.emit('timeout');
      } else {
        // Tweet received
        this.resetBackoff();
        console.log({
          code: '200',
          data: 'TWEET',
          message: data,
        });
        if (cb) {
          await cb(json);
        }
      }
    });

    twitterStream.on('error', (error) => {
      let logMessage;
      if (error.name === 'AbortError') {
        logMessage = {
          code: '408',
          title: 'TIMEOUT_ERROR',
          message: `Timeout of ${this.timeout} has been exceeded`,
        };
        clearTimeout(this.timeout);
        twitterStream.emit('timeout');
      } else {
        logMessage = {
          code: '500',
          title: 'STREAM_ERROR',
          message: error.message,
        };
      }
      console.error(logMessage);
    });

    twitterStream.on('timeout', async () => {
      if (this.retry) {
        await this.constructor.__sleep(this.currentBackoff);
        const retryStream = await this.createConnection();
        this.increaseBackoff(this.customBackoff);
        await this.readStream(retryStream);
      }
    });
  }

  // help

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
    console.log(response);
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
    console.log(response);
  }

  async overwriteRules(hashtag) {
    const rules = await this.getRules();
    console.log('Rules', rules);
    try {
      const ids = rules.data.map((item) => item.id);
      await this.deleteRules(ids);
    } catch (error) {
      console.log(error);
    }
    await this.createRules(hashtag);
  }
}

exports.TwitterStreams = TwitterStreams;
