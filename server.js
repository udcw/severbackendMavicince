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
      test_payment: "GET /test-payment",
      test_maviance: "POST /test-maviance"
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
    example_curl: `curl -X POST https://severbackendmavicince.onrender.com/api/payments/initialize \\
      -H "Content-Type: application/json" \\
      -H "Authorization: Bearer <votre_token_jwt>" \\
      -d '{
        "amount": 1000,
        "phone": "690000000",
        "payment_method": "mtn",
        "description": "Test paiement Maviance"
      }'`
  });
});

// Route de test direct Maviance
app.post("/test-maviance", async (req, res) => {
  try {
    const { phone = "690000000", method = "mtn" } = req.body;
    
    // Test direct de l'API Maviance
    const MAVIANCE_CONFIG = {
      publicKey: process.env.MAVIANCE_PUBLIC_KEY || "edd2d988-2eed-46cb-a29f-af813cf49087",
      secretKey: process.env.MAVIANCE_SECRET_KEY || "599b94e1-b4bc-4e99-890b-2a346cb8a017",
      baseUrl: process.env.MAVIANCE_BASE_URL || "https://s3p.smobilpay.staging.maviance.info/v2",
      merchantNumber: process.env.MAVIANCE_MERCHANT_NUMBER || "677777777"
    };

    console.log("🧪 Test direct Maviance avec clés:");
    console.log("Public Key:", MAVIANCE_CONFIG.publicKey);
    console.log("Base URL:", MAVIANCE_CONFIG.baseUrl);

    // 1. Tester l'authentification
    const authString = Buffer.from(`${MAVIANCE_CONFIG.publicKey}:${MAVIANCE_CONFIG.secretKey}`).toString('base64');
    
    const tokenResponse = await fetch(`${MAVIANCE_CONFIG.baseUrl}/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${authString}`
      },
      body: 'grant_type=client_credentials'
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(`Erreur authentification: ${tokenResponse.status} - ${errorText}`);
    }

    const tokenData = await tokenResponse.json();
    
    res.json({
      success: true,
      message: "✅ Connexion Maviance réussie!",
      test: {
        authentication: "OK",
        token_received: !!tokenData.access_token,
        token_length: tokenData.access_token?.length,
        public_key: MAVIANCE_CONFIG.publicKey.substring(0, 10) + "...",
        base_url: MAVIANCE_CONFIG.baseUrl,
        environment: "STAGING",
        merchant_number: MAVIANCE_CONFIG.merchantNumber
      },
      next_steps: [
        "1. Utilisez POST /api/payments/initialize pour créer un paiement",
        "2. Le frontend doit rediriger vers paymentUrl",
        "3. Maviance enverra un webhook au succès/échec"
      ],
      test_customer: {
        phone: "690000000",
        amount: "100 FCFA",
        method: "mtn"
      }
    });

  } catch (error) {
    console.error("❌ Test Maviance échoué:", error.message);
    
    res.status(500).json({
      success: false,
      message: "❌ Échec de la connexion à Maviance",
      error: error.message,
      debug: {
        public_key: process.env.MAVIANCE_PUBLIC_KEY ? "✓ Défini" : "✗ Manquant",
        secret_key: process.env.MAVIANCE_SECRET_KEY ? "✓ Défini" : "✗ Manquant",
        base_url: process.env.MAVIANCE_BASE_URL || "Valeur par défaut",
        current_env: process.env.NODE_ENV || 'non défini'
      },
      solution: "Vérifiez que les clés Maviance sont correctes dans le fichier .env"
    });
  }
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    mode: process.env.NODE_ENV || 'development',
    provider: "Maviance SmobilPay",
    webhook_url: "https://severbackendmavicince.onrender.com/api/payments/webhook/maviance",
    config: {
      public_key: process.env.MAVIANCE_PUBLIC_KEY ? "✓ Configuré" : "✗ Manquant",
      base_url: process.env.MAVIANCE_BASE_URL || "default",
      environment: process.env.NODE_ENV || 'development'
    }
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
  console.log(`Serveur Maviance démarré sur le port ${PORT}`);
  console.log(`URL: http://localhost:${PORT}`);
  console.log(`Accessible depuis: https://severbackendmavicince.onrender.com`);
  console.log(`Mode: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Webhook Maviance: https://severbackendmavicince.onrender.com/api/payments/webhook/maviance`);
  console.log(`Variables d'environnement chargées:`, {
    NODE_ENV: process.env.NODE_ENV,
    SUPABASE_URL: process.env.SUPABASE_URL ? '✓' : '✗',
    MAVIANCE_PUBLIC_KEY: process.env.MAVIANCE_PUBLIC_KEY ? '✓' : '✗',
    MAVIANCE_SECRET_KEY: process.env.MAVIANCE_SECRET_KEY ? '✓' : '✗',
    MAVIANCE_BASE_URL: process.env.MAVIANCE_BASE_URL || 'default',
    MAVIANCE_MERCHANT_NUMBER: process.env.MAVIANCE_MERCHANT_NUMBER || 'default'
  });
});