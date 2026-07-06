const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 5327;
const app = createApp();

app.listen(PORT, () => {
  console.log('Postbird running');
  console.log(`  Admin panel : http://localhost:${PORT}/admin`);
  console.log(`  Health      : http://localhost:${PORT}/api/health`);
});
