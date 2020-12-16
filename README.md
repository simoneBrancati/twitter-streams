# twitter-streams

## QuickStart

```js
const bearerToken = 'xxxxxxxxxxx';
const url = 'https://api.twitter.com/2/tweets/search/stream?tweet.fields=created_at&expansions=author_id&user.fields=name,username,profile_image_url';


const configuration = {
  timeout: 30000,
  retry: {
    base: 10000,
  },
};

const ts = new TwitterStreams(bearerToken, configuration);

(async () => {
  await ts.createRules('googledown');
  const stream = await ts.createConnection(url);
  ts.readStream(stream, async () => {
    // your tweet processing logic here
  });
})();
```