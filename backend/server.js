import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import contentRoutes from './routes/content.js';
import creatorsRoutes from './routes/creators.js';
import apiRoutes from './routes/api.js';
import authRoutes from './routes/auth.js';
import sponsorRoutes from './routes/sponsor.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Authentication routes
app.use('/api/auth', authRoutes);

// Sponsorship routes
app.use('/api/sponsor', sponsorRoutes);

// Versioned API routes (with API key auth)
app.use('/api', apiRoutes);

// Creator management routes
app.use('/api', creatorsRoutes);

// Content routes
app.use('/api', contentRoutes);

app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
