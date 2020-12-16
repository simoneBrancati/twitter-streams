# twitter-streams

### QuickStart

```js
const bearerToken = 'xxxxxxxxxxx';
const url = 'https://api.twitter.com/2/tweets/search/stream?tweet.fields=created_at&expansions=author_id&user.fields=name,username,profile_image_url';


const configuration = {
  timeout: 30000,
  retry: {
    base: 10000,
    customBackoff: (backoff) => (
      backoff + 5000
    )
  },
};

const ts = new TwitterStreams(bearerToken, url, configuration);

(async () => {
  await ts.createRules('googledown');
  const stream = await ts.createConnection();
  ts.processStream(stream, async (tweet) => {
    // your tweet processing logic here
  });
})();
```

### Api

#### TwitterStreams object
```js
const ts = new TwitterStreams(bearerToken, url, configuration);
```

* `bearerToken`: Twitter Api authentication token
* `url`: Twitter stream url
* `configuration`: TwitterStreams configuration

#### Configuration

```js
const configuration = {
  timeout: 30000,
  retry: {
    base: 10000,
    customBackoff: (backoff) => (
      backoff + 5000
    )
  },
  logLevel: 'info'
}
```

* `timeout`: maximum time between two stream data points.
  If timeout is exceeded the connection will be considered stale.
  Default: 20000 ms.
* `retry`: retry options. If is set the retry mechanism will intervene in case of disconnection or stale connection. `retry` can be a boolean value or an object containing custom options.
* `base`: backoff time to wait before retrying the connection. Default: 15000 ms.
* `customBackoff`: custom backoff algorithm to manage the retry mechanism. Default: exponential.
* `logLevel`: Stream log level. Default: info.

### Create connection

Create a stream connection to the specified url in the TwitterStreams constructor.

```js
const ts = new TwitterStreams(bearerToken, url, configuration);
const stream = await ts.createConnection();
```

### Process Stream

Use a stream connection to process data in a stream

```js
const ts = new TwitterStreams(bearerToken, url, configuration);
const stream = await ts.createConnection();
ts.processStream(stream);
```

You can optionally give, as callback to `processStream`, a custom function to process tweet data.
Your custom function must accept only one argument, which is the `tweet` parsed JSON object.

```js
ts.processStream(stream, async (tweet) => {
  console.log(tweet);
  // your tweet processing logic here
});
```

### Twitter stream rules

Create Twitter stream rules on specific hashtag.
> Use this the first time you use TwitterStream.

```js
const ts = new TwitterStreams(bearerToken, url, configuration);
await ts.createRules('myhashtag');
```

Get active Twitter stream rules

```js
await ts.getRules();
```

Delete Twitter stream rules on a specific hashtag.

```js
await ts.deleteRules('myhashtag');
```

Overwrite Twitter stream rules
> Use this when you want to change hashtag.

```js
await ts.overwriteRules('myhashtag');
```
