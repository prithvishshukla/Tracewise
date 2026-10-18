import express from 'express';

const app = express();

// A route that happens to share a path with a provider endpoint. No provider SDK is imported here.
app.get('/v1/charges', (_req, res) => res.json({ ok: true }));

app.listen(3000);
