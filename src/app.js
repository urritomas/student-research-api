const express = require('express');
const app = express();

app.use(express.json()); // For parsing application/json
app.use(express.urlencoded({ extended: true })); // For parsing application/x-www-form-urlencoded

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.get('/api/users', (req, res) => {
  res.json([
    { id: 1, name: 'admin' },
  ]);
});

app.use((req, res) => {
  res.status(404).send('Page not found');
});

module.exports = app;
