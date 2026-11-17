import express from 'express';

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.use((_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such endpoint.' } });
});

app.listen(port, () => {
  console.log(`AML API listening on http://localhost:${port}`);
});
