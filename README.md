# twitter-streams

## QuickStart

```js
const bearerToken = 'xxxxxxxxxxx';

const configuration = {
  timeout: 30000,
  retry: {
    base: 10000,
  },
};

const ts = new TwitterStreams(bearerToken, configuration);

(async () => {
  await ts.createRules('googledown');
  const stream = await ts.createConnection();
  ts.readStream(stream, async () => {
    // your tweet processing logic here
  });
})();
```