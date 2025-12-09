require('dotenv').config();
const express = require("express");
const cors = require("cors");
const paymentRoutes = require("./routes/payments");

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/api/payments", paymentRoutes);

// Routes de base
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "✅ Serveur Maviance SmobilPay fonctionnel",
    version: "4.0.0",
    mode: process.env.NODE_ENV === 'production' ? 'LIVE' : 'STAGING',
    endpoints: {
      initialize: "POST /api/payments/initialize",
      verify: "GET /api/payments/verify/:reference",
      webhook: "POST /api/payments/webhook/maviance",
      config: "GET /api/payments/config",
      health: "GET /health",
      test_payment: "GET /test-payment"
    },
    instructions: "Système de paiement Maviance SmobilPay opérationnel"
  });
});

// Route de test
app.get("/test-payment", (req, res) => {
  res.json({
    message: "Pour tester le paiement:",
    steps: [
      "1. Créez un utilisateur via l'app mobile",
      "2. Utilisez le token JWT dans l'en-tête Authorization",
      "3. POST /api/payments/initialize avec les données de paiement"
    ],
    example_curl: `curl -X POST https://severbackendnotchpay.onrender.com/api/payments/initialize \\
      -H "Content-Type: application/json" \\
      -H "Authorization: Bearer <votre_token_jwt>" \\
      -d '{
        "amount": 1000,
        "phone": "690000000",
        "payment_method": "mtn",
        "description": "Test paiement"
      }'`
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    mode: process.env.NODE_ENV || 'development',
    provider: "Maviance SmobilPay",
    webhook_url: "https://severbackendnotchpay.onrender.com/api/payments/webhook/maviance"
  });
});

// Routes non trouvées
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route non trouvée",
    path: req.path,
    method: req.method
  });
});

// Gestionnaire d'erreurs
app.use((err, req, res, next) => {
  console.error('❌ Erreur serveur:', err);
  res.status(500).json({
    success: false,
    message: 'Erreur interne du serveur',
    error: process.env.NODE_ENV === 'production' ? undefined : err.message
  });
});

// Démarrer le serveur
app.listen(PORT, () => {
  console.log(`🚀 Serveur Maviance démarré sur le port ${PORT}`);
  console.log(`🔗 URL: http://localhost:${PORT}`);
  console.log(`🌍 Accessible depuis: https://severbackendnotchpay.onrender.com`);
  console.log(`📡 Mode: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔧 Webhook Maviance: https://severbackendnotchpay.onrender.com/api/payments/webhook/maviance`);
  console.log(`⚙️ Variables d'environnement chargées:`, {
    NODE_ENV: process.env.NODE_ENV,
    SUPABASE_URL: process.env.SUPABASE_URL ? '✓' : '✗',
    MAVIANCE_PUBLIC_KEY: process.env.MAVIANCE_PUBLIC_KEY ? '✓' : '✗',
    MAVIANCE_SECRET_KEY: process.env.MAVIANCE_SECRET_KEY ? '✓' : '✗'
  });
});